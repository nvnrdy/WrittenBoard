/**
 * WrittenBoard broadcast worker.
 *
 * Modes (BROADCAST_MODE):
 * - dry-run (default): full queue logic, no ffmpeg, never claims a YouTube broadcast.
 * - record: renders the real stream into a local .flv file. Use it to check output.
 * - rtmp: streams continuously to YouTube Live (needs ffmpeg + YOUTUBE_STREAM_KEY).
 *
 * Design:
 * - One worker at a time holds a Firestore lease (system/broadcast_worker); others wait as standby.
 * - One long-lived encoder keeps the stream connected; items and the idle slate are fed to it.
 * - Revoke/reject, Skip and Pause UGC take the current item off air immediately.
 * - Status writes are fenced by a per-claim id, so a revoked item is never marked broadcast.
 * - Items left `playing` by a crashed worker are requeued (bounded retries) on takeover.
 */
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import { db, getBucket } from '../lib/firebase/admin'
import { loadConfig, type WorkerConfig } from './broadcast/config'
import { prepareFont, renderSlateFrame } from './broadcast/frames'
import { WorkerLease } from './broadcast/lease'
import { Compositor, EncoderSink, NullSink, type FrameSink } from './broadcast/output'
import { EMPTY_FRAME, playItem } from './broadcast/player'
import { BroadcastQueue, type ClaimedItem } from './broadcast/queue'
import type { PlayOutcome } from './broadcast/transitions'

const log = (msg: string) => console.log(`[broadcast ${new Date().toISOString()}] ${msg}`)

const state = {
  phase: 'starting' as string,
  onAir: null as string | null,
  stopReason: null as string | null,
}
const stopController = new AbortController()

function requestStop(reason: string, exitCode = 0) {
  if (stopController.signal.aborted) return
  state.stopReason = reason
  process.exitCode = exitCode
  log(`stopping: ${reason}`)
  stopController.abort(reason)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      stopController.signal.removeEventListener('abort', done)
      resolve()
    }
    stopController.signal.addEventListener('abort', done, { once: true })
  })
}

function run(cmd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))))
  })
}

async function checkFfmpeg(cfg: WorkerConfig) {
  let filters = ''
  try {
    filters = await run(cfg.ffmpeg, ['-hide_banner', '-filters'])
  } catch {
    throw new Error(`ffmpeg not found at "${cfg.ffmpeg}". Install it or set FFMPEG_PATH.`)
  }
  if (!/\bdrawtext\b/.test(filters)) throw new Error('This ffmpeg build lacks the drawtext filter (needs libfreetype)')
  try {
    await fs.access(cfg.fontFile)
  } catch {
    throw new Error(`Font not found at "${cfg.fontFile}". Set BROADCAST_FONT_FILE to a .ttf/.otf file.`)
  }
}

/** Removes temp files left by a previous crash. Leaves recordings alone. */
async function cleanWorkDir(dir: string) {
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith('item-') || name.startsWith('txt-')) await fs.rm(`${dir}/${name}`, { force: true })
  }
}

function startHealthServer(port: number, details: () => Record<string, unknown>): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...state, ...details() }))
  })
  server.listen(port, () => log(`health endpoint on :${port}`))
  return server
}

async function finishWithRetry(queue: BroadcastQueue, item: ClaimedItem, outcome: PlayOutcome, error: string | null) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await queue.finish(item, outcome, error)
    } catch (err) {
      if (attempt >= 5) {
        log(`could not record result for ${item.id}; it will be recovered on next start: ${(err as Error).message}`)
        return false
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

async function main() {
  const cfg = loadConfig()
  log(`starting in ${cfg.mode} mode as ${cfg.workerId}`)
  await fs.mkdir(cfg.workDir, { recursive: true })
  await cleanWorkDir(cfg.workDir)
  if (cfg.mode !== 'dry-run') {
    await checkFfmpeg(cfg)
    await prepareFont(cfg)
  }

  let sink: FrameSink | null = null
  const lease = new WorkerLease(db, cfg, log)
  const health = cfg.healthPort
    ? startHealthServer(cfg.healthPort, () => ({ mode: cfg.mode, leaseHeld: lease.held, encoderUp: sink?.isUp ?? false }))
    : null

  process.on('SIGINT', () => (stopController.signal.aborted ? process.exit(130) : requestStop('SIGINT')))
  process.on('SIGTERM', () => requestStop('SIGTERM'))

  // 1. Become the only active worker.
  state.phase = 'standby'
  let announced = false
  while (!stopController.signal.aborted) {
    const result = await lease.acquire().catch((err) => {
      log(`lease acquire failed: ${(err as Error).message}`)
      return { acquired: false, holder: undefined }
    })
    if (result.acquired) break
    if (!announced && result.holder) log(`standby: another worker (${result.holder}) is active`)
    announced = true
    await sleep(cfg.pollMs)
  }
  if (stopController.signal.aborted) {
    health?.close()
    return
  }
  log('lease acquired')
  lease.startRenewing((reason) => requestStop(`lease lost (${reason})`, 1))

  // 2. Recover anything a crashed worker left on air.
  const queue = new BroadcastQueue(db, cfg, log)
  const recovered = await queue.recoverOrphans()
  if (recovered) log(`recovered ${recovered} item(s) left playing by a previous worker`)

  // 3. Start the continuous output.
  const slate = cfg.mode === 'dry-run' ? EMPTY_FRAME : await renderSlateFrame(cfg)
  const encoder = cfg.mode === 'dry-run' ? null : new EncoderSink(cfg, log)
  sink = encoder ?? new NullSink()
  const compositor = new Compositor(cfg.fps, sink, slate)
  encoder?.start()
  compositor.start()

  // 4. Play the queue.
  let lastUserId: string | undefined
  let lastType: string | undefined
  while (!stopController.signal.aborted) {
    try {
      const settings = (await queue.settingsRef.get()).data() || {}
      lastUserId = settings.lastPlayedUserId || lastUserId
      lastType = settings.lastPlayedType || lastType
      if (settings.ugcPaused === true) {
        state.phase = 'paused'
        await sleep(cfg.pollMs)
        continue
      }
      const item = await queue.claimNext(lastUserId, lastType)
      if (!item) {
        state.phase = 'idle'
        await sleep(cfg.pollMs)
        continue
      }
      state.phase = 'playing'
      state.onAir = item.id
      log(`playing ${item.id} (${item.type}, attempt ${item.attempts})`)
      const { outcome, error } = await playItem(
        { cfg, db, bucket: getBucket, compositor, log, onAir: (i) => queue.setOnAir(i) },
        item,
        settings.skipToken,
        stopController.signal,
      )
      const aired = await finishWithRetry(queue, item, outcome, error)
      log(`finished ${item.id}: ${outcome}${error ? ` (${error})` : ''}`)
      if (aired) {
        lastUserId = item.userId
        lastType = item.type
      }
    } catch (err) {
      log(`loop error: ${(err as Error).message}`)
      await sleep(cfg.pollMs)
    } finally {
      state.onAir = null
    }
  }

  // 5. Shut down cleanly: slate off, close the stream, free the lease.
  state.phase = 'stopping'
  compositor.stop()
  await encoder?.stop()
  await lease.release()
  health?.close()
  log('stopped')
}

main().then(
  () => process.exit(),
  (err) => {
    log(`fatal: ${(err as Error).message}`)
    process.exit(1)
  },
)
