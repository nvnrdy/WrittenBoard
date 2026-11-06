/**
 * WrittenBoard broadcast worker.
 *
 * Modes (BROADCAST_MODE):
 * - dry-run (default): full queue logic, no ffmpeg, never claims a YouTube broadcast.
 * - record: renders the real stream into a local .flv file. Use it to check output.
 * - rtmp: streams continuously to YouTube Live (needs ffmpeg + YOUTUBE_STREAM_KEY).
 * - obs: drives local OBS Studio scenes via WebSocket v5. OBS owns YouTube; worker
 *   never reads YOUTUBE_STREAM_KEY / BROADCAST_RTMP_URL. Completions write played_obs,
 *   not submission status=broadcast.
 *
 * Design:
 * - One worker at a time holds a Firestore lease (system/broadcast_worker); others wait as standby.
 * - dry-run/record/rtmp: one long-lived encoder keeps the stream connected; items and the idle slate are fed to it.
 * - obs: no encoder; ObsPresenter switches Holding/Content and never owns the stream key.
 * - Revoke/reject, Skip and Pause UGC take the current item off air immediately.
 * - Status writes are fenced by a per-claim id, so a revoked item is never marked broadcast.
 * - Items left `playing` by a crashed worker are requeued (bounded retries) on takeover.
 */
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import { db, getBucket } from '../lib/firebase/admin'
import { loadConfig, redactSecrets, type WorkerConfig } from './broadcast/config'
import { prepareFont, renderSlateFrame } from './broadcast/frames'
import { WorkerLease } from './broadcast/lease'
import { Compositor, EncoderSink, NullSink, type FrameSink } from './broadcast/output'
import { EMPTY_FRAME, playItem, playItemObs } from './broadcast/player'
import { BroadcastQueue, type ClaimedItem } from './broadcast/queue'
import type { PlayOutcome } from './broadcast/transitions'
import { createObsClient, type ObsClient } from './broadcast/obs/client'
import { ObsPresenter } from './broadcast/obs/presenter'

const log = (msg: string) => console.log(`[broadcast ${new Date().toISOString()}] ${msg}`)

const state = {
  phase: 'starting' as string,
  onAir: null as string | null,
  stopReason: null as string | null,
  obsConnected: false,
  holdingRestored: null as boolean | null,
}
const stopController = new AbortController()

function requestStop(reason: string, exitCode = 0) {
  if (stopController.signal.aborted) return
  state.stopReason = reason
  process.exitCode = exitCode
  log(`stopping: ${redactSecrets(reason, [])}`)
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
    if (name.startsWith('item-') || name.startsWith('txt-') || name.startsWith('obs-')) {
      await fs.rm(`${dir}/${name}`, { force: true })
    }
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

async function runCompositorLoop(cfg: WorkerConfig, lease: WorkerLease, queue: BroadcastQueue, health: Server | null) {
  const slate = cfg.mode === 'dry-run' ? EMPTY_FRAME : await renderSlateFrame(cfg)
  const encoder = cfg.mode === 'dry-run' ? null : new EncoderSink(cfg, (m) => log(redactSecrets(m, cfg.redact)))
  const sink: FrameSink = encoder ?? new NullSink()
  const compositor = new Compositor(cfg.fps, sink, slate)
  if (encoder) await encoder.start()
  compositor.start()

  let lastUserId: string | undefined
  let lastType: string | undefined
  while (!stopController.signal.aborted) {
    try {
      if (cfg.mode === 'record' && encoder && !encoder.isUp) {
        requestStop(
          `recording encoder failed${encoder.lastError ? `: ${encoder.lastError.message}` : ''}`,
          1,
        )
        break
      }
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
        {
          cfg,
          db,
          bucket: getBucket,
          compositor,
          log: (m) => log(redactSecrets(m, cfg.redact)),
          onAir: (i) => queue.setOnAir(i),
          recordingOk: cfg.mode === 'record' ? () => encoder?.isUp ?? false : undefined,
          recordingError: cfg.mode === 'record'
            ? () => encoder?.lastError?.message ?? 'Recording encoder is not available'
            : undefined,
        },
        item,
        settings.skipToken,
        stopController.signal,
      )
      const aired = await finishWithRetry(queue, item, outcome, error)
      log(`finished ${item.id}: ${outcome}${error ? ` (${redactSecrets(error, cfg.redact)})` : ''}`)
      if (aired) {
        lastUserId = item.userId
        lastType = item.type
      }
      if (cfg.mode === 'record' && encoder && !encoder.isUp) {
        requestStop(
          `recording encoder failed${encoder.lastError ? `: ${encoder.lastError.message}` : ''}`,
          1,
        )
        break
      }
    } catch (err) {
      log(`loop error: ${redactSecrets((err as Error).message, cfg.redact)}`)
      await sleep(cfg.pollMs)
    } finally {
      state.onAir = null
    }
  }

  state.phase = 'stopping'
  compositor.stop()
  await encoder?.stop()
  await lease.release()
  health?.close()
  log('stopped')
}

async function runObsLoop(cfg: WorkerConfig, lease: WorkerLease, queue: BroadcastQueue, health: Server | null) {
  if (!cfg.obs) throw new Error('OBS config missing')

  let client: ObsClient | null = null
  let presenter: ObsPresenter | null = null

  try {
    client = createObsClient()
    // Password is passed only into connect(); never logged.
    await client.connect(cfg.obs.websocketUrl, cfg.obs.password)
    state.obsConnected = true
    presenter = new ObsPresenter(client, cfg, (m) => log(redactSecrets(m, cfg.redact)))
    await presenter.startup()
    state.holdingRestored = true
  } catch (err) {
    state.obsConnected = false
    state.holdingRestored = false
    const message = redactSecrets((err as Error).message, cfg.redact)
    log(`OBS startup failed (fail closed): ${message}`)
    try { await client?.disconnect() } catch { /* ignore */ }
    await lease.release()
    health?.close()
    throw new Error(`OBS startup failed: ${message}`)
  }

  let lastUserId: string | undefined
  let lastType: string | undefined
  while (!stopController.signal.aborted) {
    try {
      if (!presenter.ok()) {
        requestStop(`OBS presenter unhealthy${presenter.lastObsError ? `: ${presenter.lastObsError}` : ''}`, 1)
        break
      }
      const settings = (await queue.settingsRef.get()).data() || {}
      lastUserId = settings.lastPlayedUserId || lastUserId
      lastType = settings.lastPlayedType || lastType
      if (settings.ugcPaused === true) {
        state.phase = 'paused'
        const holding = await presenter.attemptHolding('ugc-paused')
        state.holdingRestored = holding.restored
        if (!holding.restored) {
          requestStop(holding.reason || 'Holding not restored while paused', 1)
          break
        }
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
      log(`playing ${item.id} (${item.type}, attempt ${item.attempts}) via OBS`)
      const { outcome, error, holdingRestored } = await playItemObs(
        {
          cfg,
          db,
          bucket: getBucket,
          presenter,
          log: (m) => log(redactSecrets(m, cfg.redact)),
          onAir: (i) => queue.setOnAir(i),
          obsOk: () => presenter?.ok() ?? false,
          obsError: () => presenter?.lastObsError ?? 'OBS presenter is not available',
        },
        item,
        settings.skipToken,
        stopController.signal,
      )
      if (holdingRestored !== undefined) state.holdingRestored = holdingRestored
      state.obsConnected = presenter.connected

      // Only completed + healthy gate path may write played_obs via planFinish.
      const aired = await finishWithRetry(queue, item, outcome, error)
      log(`finished ${item.id}: ${outcome}${error ? ` (${redactSecrets(error, cfg.redact)})` : ''}`)
      if (aired) {
        lastUserId = item.userId
        lastType = item.type
      }
      if (!presenter.connected) {
        requestStop('OBS disconnected after item', 1)
        break
      }
      if (holdingRestored === false) {
        // Fail closed: never continue claiming while Holding is unconfirmed.
        requestStop(
          `Holding not restored after item${presenter.lastObsError ? `: ${presenter.lastObsError}` : ''}`,
          1,
        )
        break
      }
    } catch (err) {
      log(`loop error: ${redactSecrets((err as Error).message, cfg.redact)}`)
      const holding = await presenter.attemptHolding('loop-error')
      state.holdingRestored = holding.restored
      if (!holding.restored || !presenter.connected) {
        requestStop(holding.reason || 'OBS unavailable after loop error', 1)
        break
      }
      await sleep(cfg.pollMs)
    } finally {
      state.onAir = null
    }
  }

  state.phase = 'stopping'
  const shutdownHolding = await presenter.shutdown()
  state.holdingRestored = shutdownHolding.restored
  if (!shutdownHolding.restored) {
    log(`shutdown: Holding not confirmed (${shutdownHolding.reason || 'unknown'})`)
  }
  try { await client.disconnect() } catch { /* ignore */ }
  state.obsConnected = false
  await lease.release()
  health?.close()
  log('stopped')
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

  const lease = new WorkerLease(db, cfg, (m) => log(redactSecrets(m, cfg.redact)))
  const health = cfg.healthPort
    ? startHealthServer(cfg.healthPort, () => ({
      mode: cfg.mode,
      leaseHeld: lease.held,
      obsConnected: state.obsConnected,
      holdingRestored: state.holdingRestored,
    }))
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
  const queue = new BroadcastQueue(db, cfg, (m) => log(redactSecrets(m, cfg.redact)))
  const recovered = await queue.recoverOrphans()
  if (recovered) log(`recovered ${recovered} item(s) left playing by a previous worker`)

  // 3. Mode-specific output / presentation path.
  if (cfg.mode === 'obs') {
    await runObsLoop(cfg, lease, queue, health)
  } else {
    await runCompositorLoop(cfg, lease, queue, health)
  }
}

main().then(
  () => process.exit(),
  (err) => {
    log(`fatal: ${redactSecrets((err as Error).message, [])}`)
    process.exit(1)
  },
)
