/**
 * Plays one claimed item: downloads/renders it, puts it on air, and watches
 * Firestore live so a revoke, reject, skip or UGC pause takes it off air
 * immediately instead of after it finishes.
 */
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import type { WorkerConfig } from './config'
import type { Compositor } from './output'
import type { ClaimedItem } from './queue'
import type { PlayOutcome } from './transitions'
import {
  StillSource,
  VideoSource,
  VIDEO_DEMUXERS,
  renderImageFrame,
  renderTextFrame,
  type FrameSource,
} from './frames'

type Bucket = { file(path: string): { createReadStream(): NodeJS.ReadableStream } }

export interface PlayerDeps {
  cfg: WorkerConfig
  db: Firestore
  bucket: () => Bucket
  compositor: Compositor
  log: (msg: string) => void
  onAir: (item: ClaimedItem) => Promise<void>
}

export const EMPTY_FRAME = Buffer.alloc(0)

/** Subscribes to the queue entry, submission and settings; aborts with the matching outcome. */
export function watchItem(db: Firestore, item: ClaimedItem, baselineSkipToken: unknown, abort: (o: PlayOutcome) => void, log: (m: string) => void) {
  const onError = (what: string) => (err: Error) => log(`watch ${what} failed for ${item.id}: ${err.message}`)
  const unsubs = [
    db.collection('broadcast_queue').doc(item.id).onSnapshot((snap) => {
      const d = snap.data()
      if (!snap.exists || d?.status !== 'playing' || d?.claimId !== item.claimId) abort('cancelled')
    }, onError('queue')),
    db.collection('submissions').doc(item.submissionId).onSnapshot((snap) => {
      if (!snap.exists || snap.data()?.status !== 'approved') abort('cancelled')
    }, onError('submission')),
    db.collection('system').doc('settings').onSnapshot((snap) => {
      const d = snap.data() || {}
      if (d.skipToken && d.skipToken !== baselineSkipToken) abort('skipped')
      else if (d.ugcPaused === true) abort('interrupted')
    }, onError('settings')),
  ]
  return () => { for (const unsub of unsubs) unsub() }
}

async function download(deps: PlayerDeps, storagePath: string, signal: AbortSignal) {
  const dest = path.join(deps.cfg.workDir, `item-${randomUUID()}.bin`)
  await pipeline(deps.bucket().file(storagePath).createReadStream(), createWriteStream(dest), { signal })
  return dest
}

async function buildSource(deps: PlayerDeps, item: ClaimedItem, files: string[], signal: AbortSignal): Promise<FrameSource> {
  const { cfg } = deps
  const holdFrames = Math.round((cfg.holdMs / 1000) * cfg.fps)
  const dryRun = cfg.mode === 'dry-run'

  if (item.type === 'text') {
    if (!item.contentText) throw new Error('Text item has no content')
    if (dryRun) return new StillSource(EMPTY_FRAME, holdFrames)
    return new StillSource(await renderTextFrame(cfg, item.contentText, item.displayName, signal), holdFrames)
  }

  if (!item.storagePath) throw new Error('Media item has no storagePath (media may have been purged)')
  if (!item.mimeType) throw new Error('Media item has no mimeType')
  // Downloading in dry-run too verifies the object exists and is readable.
  const file = await download(deps, item.storagePath, signal)
  files.push(file)

  if (item.type === 'image') {
    if (dryRun) return new StillSource(EMPTY_FRAME, holdFrames)
    return new StillSource(await renderImageFrame(cfg, file, item.mimeType, signal), holdFrames)
  }

  const demuxer = VIDEO_DEMUXERS[item.mimeType]
  if (!demuxer) throw new Error(`Unsupported video type ${item.mimeType}`)
  if (dryRun) {
    const seconds = Math.min(cfg.maxVideoSeconds, item.durationSeconds ?? cfg.holdMs / 1000)
    return new StillSource(EMPTY_FRAME, Math.max(1, Math.round(seconds * cfg.fps)))
  }
  return VideoSource.start(cfg, file, demuxer, signal)
}

/**
 * Plays an item to completion or until aborted. Never throws.
 * `externalSignal` aborts for worker shutdown / lease loss.
 */
export async function playItem(
  deps: PlayerDeps,
  item: ClaimedItem,
  baselineSkipToken: unknown,
  externalSignal: AbortSignal,
): Promise<{ outcome: PlayOutcome; error: string | null }> {
  const ac = new AbortController()
  const abort = (outcome: PlayOutcome) => { if (!ac.signal.aborted) ac.abort(outcome) }
  const onExternal = () => abort('interrupted')
  if (externalSignal.aborted) return { outcome: 'interrupted', error: null }
  externalSignal.addEventListener('abort', onExternal, { once: true })

  const unwatch = watchItem(deps.db, item, baselineSkipToken, abort, deps.log)
  const files: string[] = []
  let source: FrameSource | null = null
  const aborted = () => ({ outcome: ac.signal.reason as PlayOutcome, error: null })

  try {
    source = await buildSource(deps, item, files, ac.signal)
    if (ac.signal.aborted) return aborted()
    await deps.onAir(item).catch((err) => deps.log(`could not publish now-showing: ${(err as Error).message}`))
    const result = await deps.compositor.play(source, ac.signal)
    if (result === 'aborted') return aborted()
    if (source.error && source instanceof VideoSource && source.emitted < deps.cfg.fps) {
      return { outcome: 'failed', error: source.error.message }
    }
    return { outcome: 'completed', error: null }
  } catch (err) {
    if (ac.signal.aborted) return aborted()
    return { outcome: 'failed', error: (err as Error).message }
  } finally {
    externalSignal.removeEventListener('abort', onExternal)
    unwatch()
    source?.stop()
    await Promise.all(files.map((f) => fs.rm(f, { force: true }).catch(() => undefined)))
  }
}
