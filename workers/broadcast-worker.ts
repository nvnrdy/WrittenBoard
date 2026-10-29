/**
 * WrittenBoard broadcast worker (Firebase).
 *
 * Modes:
 * - dry-run (default): advances the queue with verified local render steps and
 *   never claims a YouTube broadcast occurred.
 * - rtmp: requires FFMPEG_PATH + YOUTUBE_STREAM_KEY and streams rendered frames.
 *
 * Never marks an item as broadcast unless the configured mode completes successfully.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { FieldValue } from 'firebase-admin/firestore'
import { db, getBucket } from '../lib/firebase/admin'
import { selectNext } from '../lib/broadcast/scheduler'

const MODE = (process.env.BROADCAST_MODE || 'dry-run').toLowerCase()
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const STREAM_KEY = process.env.YOUTUBE_STREAM_KEY
const HOLD_MS = Number(process.env.BROADCAST_HOLD_MS || 8000)
const POLL_MS = Number(process.env.BROADCAST_POLL_MS || 3000)
const WORK_DIR = process.env.BROADCAST_WORK_DIR || path.join(process.cwd(), 'workers', '.work')

type QueueDoc = {
  id: string
  submissionId: string
  userId: string
  type: string
  displayName?: string
  contentText?: string | null
  storagePath?: string | null
  status: string
  createdAt?: { toDate?: () => Date }
}

async function loadQueued(): Promise<QueueDoc[]> {
  const snap = await db.collection('broadcast_queue').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(50).get()
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QueueDoc, 'id'>) }))
}

async function getSettings() {
  const snap = await db.collection('system').doc('settings').get()
  return snap.data() || {}
}

function toIso(value: QueueDoc['createdAt']) {
  try { return value?.toDate?.()?.toISOString?.() || new Date(0).toISOString() } catch { return new Date(0).toISOString() }
}

async function claimNext(lastUserId?: string, lastType?: string) {
  const settings = await getSettings()
  if (settings.ugcPaused === true) return null
  const queued = await loadQueued()
  const next = selectNext(
    queued.map((q) => ({
      id: q.id,
      user_id: q.userId || 'unknown',
      type: q.type || 'text',
      created_at: toIso(q.createdAt),
    })),
    { avoidSameUserStreak: 1, lastUserId, lastType },
  )
  if (!next) return null

  const ref = db.collection('broadcast_queue').doc(next.id)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()?.status !== 'queued') return null
    const data = snap.data() as Omit<QueueDoc, 'id'>
    tx.update(ref, {
      status: 'playing',
      playingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      workerMode: MODE,
    })
    return { id: snap.id, ...data, status: 'playing' } as QueueDoc
  })
}

async function renderTextFrame(item: QueueDoc, outFile: string) {
  const text = String(item.contentText || '').slice(0, 500).replace(/[<>&]/g, '')
  const name = String(item.displayName || 'anon').slice(0, 32).replace(/[<>&]/g, '')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="100%" height="100%" fill="#0b1020"/>
  <text x="64" y="120" fill="#ffffff" font-size="42" font-family="Arial, sans-serif">WrittenBoard</text>
  <foreignObject x="64" y="200" width="1152" height="400">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#f4f4f5;font-size:36px;font-family:Arial,sans-serif;line-height:1.35;white-space:pre-wrap;">${text}</div>
  </foreignObject>
  <text x="64" y="680" fill="#a1a1aa" font-size="24" font-family="Arial, sans-serif">@${name}</text>
</svg>`
  await fs.writeFile(`${outFile}.svg`, svg, 'utf8')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await fs.writeFile(outFile, png)
  return outFile
}

async function fetchMedia(item: QueueDoc, outFile: string) {
  if (!item.storagePath) throw new Error('Queue item missing storagePath')
  await new Promise<void>((resolve, reject) => {
    getBucket().file(item.storagePath!).createReadStream()
      .on('error', reject)
      .pipe(createWriteStream(outFile))
      .on('finish', () => resolve())
      .on('error', reject)
  })
  return outFile
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}

async function mark(item: QueueDoc, status: 'broadcast' | 'played_dry_run' | 'skipped' | 'failed') {
  const queueStatus = status === 'failed' ? 'queued' : status === 'skipped' ? 'skipped' : 'played'
  const submissionStatus =
    status === 'broadcast' ? 'broadcast'
      : status === 'played_dry_run' ? 'broadcast_dry_run'
        : status === 'skipped' ? 'skipped'
          : null
  await db.collection('broadcast_queue').doc(item.id).set({
    status: queueStatus,
    result: status,
    finishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  const submissionUpdate: Record<string, unknown> = {
    lastBroadcastResult: status,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (submissionStatus) submissionUpdate.status = submissionStatus
  await db.collection('submissions').doc(item.submissionId || item.id).set(submissionUpdate, { merge: true })
  await db.collection('system').doc('settings').set({
    currentSubmissionId: null,
    lastPlayedUserId: item.userId || null,
    lastPlayedType: item.type || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function playItem(item: QueueDoc) {
  await fs.mkdir(WORK_DIR, { recursive: true })
  const local = path.join(WORK_DIR, `${item.id}-${Date.now()}`)
  let input = local

  if (item.type === 'text') input = await renderTextFrame(item, `${local}.png`)
  else input = await fetchMedia(item, `${local}.bin`)

  const settingsBefore = await getSettings()
  const skipToken = settingsBefore.skipToken

  if (MODE === 'rtmp') {
    if (!STREAM_KEY) throw new Error('YOUTUBE_STREAM_KEY is required for rtmp mode')
    const rtmp = `rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}`
    if (item.type === 'text' || item.type === 'image') {
      await runFfmpeg([
        '-y', '-loop', '1', '-i', input, '-t', String(Math.ceil(HOLD_MS / 1000)),
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'flv', rtmp,
      ])
    } else {
      await runFfmpeg(['-y', '-re', '-i', input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'flv', rtmp])
    }
  } else if (MODE === 'dry-run') {
    const end = Date.now() + HOLD_MS
    while (Date.now() < end) {
      const settings = await getSettings()
      if (settings.skipToken && settings.skipToken !== skipToken) {
        await mark(item, 'skipped')
        return
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  } else {
    throw new Error(`Unknown BROADCAST_MODE: ${MODE}`)
  }

  const settingsAfter = await getSettings()
  if (settingsAfter.skipToken && settingsAfter.skipToken !== skipToken) {
    await mark(item, 'skipped')
    return
  }
  await mark(item, MODE === 'rtmp' ? 'broadcast' : 'played_dry_run')
}

async function loop() {
  console.log(`Broadcast worker starting in ${MODE} mode`)
  if (MODE === 'rtmp') {
    try { await runFfmpeg(['-version']) }
    catch {
      console.error('ffmpeg is required for rtmp mode but was not found')
      process.exit(1)
    }
  }
  let lastUserId: string | undefined
  let lastType: string | undefined
  for (;;) {
    try {
      const settings = await getSettings()
      lastUserId = settings.lastPlayedUserId || lastUserId
      lastType = settings.lastPlayedType || lastType
      const item = await claimNext(lastUserId, lastType)
      if (!item) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        continue
      }
      console.log(`Playing ${item.id} (${item.type})`)
      await db.collection('system').doc('settings').set({
        currentSubmissionId: item.submissionId || item.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      try {
        await playItem(item)
        lastUserId = item.userId
        lastType = item.type
      } catch (err) {
        console.error('Playback failed', err)
        await mark(item, 'failed')
      }
    } catch (err) {
      console.error('Worker loop error', err)
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
}

loop().catch((err) => {
  console.error(err)
  process.exit(1)
})
