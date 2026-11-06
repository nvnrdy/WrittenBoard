import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { FakeFirestore } from './helpers/fake-firestore'
import { loadConfig, type WorkerConfig } from '../workers/broadcast/config'
import { BroadcastQueue } from '../workers/broadcast/queue'
import { WorkerLease } from '../workers/broadcast/lease'
import { Compositor, NullSink } from '../workers/broadcast/output'
import { EMPTY_FRAME, playItem, type PlayerDeps } from '../workers/broadcast/player'

const silent = () => undefined
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let fake: FakeFirestore
let db: Firestore
let cfg: WorkerConfig
let compositor: Compositor
let workDir: string

async function seed(id: string, opts: { type?: string; status?: string; userId?: string; storagePath?: string | null; mimeType?: string } = {}) {
  const type = opts.type || 'text'
  await fake.collection('submissions').doc(id).set({
    id,
    userId: opts.userId || 'u1',
    displayName: 'CuriousComet482',
    type,
    contentText: type === 'text' ? 'hello' : null,
    storagePath: opts.storagePath ?? null,
    mimeType: opts.mimeType ?? null,
    status: opts.status || 'approved',
  })
  await fake.collection('broadcast_queue').doc(id).set({
    submissionId: id,
    userId: opts.userId || 'u1',
    type,
    status: 'queued',
    createdAt: Timestamp.fromMillis(Date.now() - 60_000),
  })
}

function deps(bucketFile?: () => NodeJS.ReadableStream): PlayerDeps {
  return {
    cfg,
    db,
    bucket: () => ({ file: () => ({ createReadStream: bucketFile || (() => Readable.from([Buffer.from('x')])) }) }),
    compositor,
    log: silent,
    onAir: async () => undefined,
  }
}

beforeEach(() => {
  fake = new FakeFirestore()
  db = fake as unknown as Firestore
  workDir = mkdtempSync(path.join(tmpdir(), 'wb-worker-'))
  cfg = loadConfig({ BROADCAST_MODE: 'dry-run', BROADCAST_HOLD_MS: '1000', BROADCAST_FPS: '50', BROADCAST_WORK_DIR: workDir })
  compositor = new Compositor(cfg.fps, new NullSink(), EMPTY_FRAME)
  compositor.start()
})

afterEach(() => {
  compositor.stop()
  rmSync(workDir, { recursive: true, force: true })
})

describe('broadcast worker flow', () => {
  it('claims, plays and records an approved item', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = await queue.claimNext()
    expect(item?.id).toBe('s1')
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'playing', attempts: 1 })

    const { outcome } = await playItem(deps(), item!, undefined, new AbortController().signal)
    expect(outcome).toBe('completed')
    await queue.finish(item!, outcome)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'played', result: 'played_dry_run', claimId: null })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'broadcast_dry_run' })
    expect(fake.peek('system/settings')).toMatchObject({ currentSubmissionId: null, lastPlayedUserId: 'u1' })
  })

  it('refuses to claim an item whose submission is no longer approved', async () => {
    await seed('s1', { status: 'revoked' })
    const queue = new BroadcastQueue(db, cfg, silent)
    expect(await queue.claimNext()).toBeNull()
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'cancelled' })
  })

  it('takes a revoked item off air immediately and keeps it revoked', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const started = Date.now()
    const playing = playItem(deps(), item, undefined, new AbortController().signal)
    await sleep(100)
    // What /api/moderation/review does on revoke:
    await fake.collection('submissions').doc('s1').update({ status: 'revoked' })
    await fake.collection('broadcast_queue').doc('s1').set({ status: 'cancelled' }, { merge: true })

    const { outcome } = await playing
    expect(outcome).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(cfg.holdMs)
    expect(await queue.finish(item, outcome)).toBe(false)
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'revoked' })
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'cancelled' })
  })

  it('skips the current item as soon as Skip is pressed', async () => {
    await seed('s1')
    await fake.collection('system').doc('settings').set({ skipToken: 'old' })
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const playing = playItem(deps(), item, 'old', new AbortController().signal)
    await sleep(100)
    await fake.collection('system').doc('settings').set({ skipToken: 'new' }, { merge: true })
    const { outcome } = await playing
    expect(outcome).toBe('skipped')
    await queue.finish(item, outcome)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'skipped' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'skipped' })
  })

  it('pausing UGC interrupts the item and requeues it without using an attempt', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const playing = playItem(deps(), item, undefined, new AbortController().signal)
    await sleep(100)
    await fake.collection('system').doc('settings').set({ ugcPaused: true }, { merge: true })
    const { outcome } = await playing
    expect(outcome).toBe('interrupted')
    await queue.finish(item, outcome)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued', attempts: 0, result: 'interrupted' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'approved' })
    expect(String(fake.peek('submissions/s1')?.status || '')).toBe('approved')
  })

  it('completes a normal image submission in dry-run', async () => {
    await seed('img1', { type: 'image', storagePath: 'submissions/img1/original', mimeType: 'image/png' })
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const { outcome } = await playItem(deps(), item, undefined, new AbortController().signal)
    expect(outcome).toBe('completed')
    await queue.finish(item, outcome)
    expect(fake.peek('broadcast_queue/img1')).toMatchObject({ status: 'played', result: 'played_dry_run' })
    expect(fake.peek('submissions/img1')).toMatchObject({ status: 'broadcast_dry_run' })
  })

  it('completes a short video in dry-run using durationSeconds', async () => {
    await fake.collection('submissions').doc('vid1').set({
      id: 'vid1', userId: 'u1', displayName: 'CuriousComet482', type: 'video',
      contentText: null, storagePath: 'submissions/vid1/original', mimeType: 'video/mp4',
      durationSeconds: 2, status: 'approved',
    })
    await fake.collection('broadcast_queue').doc('vid1').set({
      submissionId: 'vid1', userId: 'u1', type: 'video', status: 'queued',
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    })
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    expect(item?.durationSeconds).toBe(2)
    const started = Date.now()
    const { outcome } = await playItem(deps(), item!, undefined, new AbortController().signal)
    expect(outcome).toBe('completed')
    expect(Date.now() - started).toBeLessThan(5_000)
    await queue.finish(item!, outcome)
    expect(fake.peek('broadcast_queue/vid1')).toMatchObject({ status: 'played', result: 'played_dry_run' })
  })

  it('caps dry-run video playback at maxVideoSeconds', async () => {
    cfg = { ...cfg, maxVideoSeconds: 1, fps: 50, holdMs: 8_000 }
    await fake.collection('submissions').doc('vidlong').set({
      id: 'vidlong', userId: 'u1', displayName: 'CuriousComet482', type: 'video',
      contentText: null, storagePath: 'submissions/vidlong/original', mimeType: 'video/mp4',
      durationSeconds: 20, status: 'approved',
    })
    await fake.collection('broadcast_queue').doc('vidlong').set({
      submissionId: 'vidlong', userId: 'u1', type: 'video', status: 'queued',
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    })
    const queue = new BroadcastQueue(db, cfg, silent)
    compositor.stop()
    compositor = new Compositor(cfg.fps, new NullSink(), EMPTY_FRAME)
    compositor.start()
    const item = (await queue.claimNext())!
    const started = Date.now()
    const { outcome } = await playItem(deps(), item, undefined, new AbortController().signal)
    const elapsed = Date.now() - started
    expect(outcome).toBe('completed')
    // 1s cap at 50fps ≈ 1000ms; must finish well under a 20s wall clock.
    expect(elapsed).toBeGreaterThanOrEqual(700)
    expect(elapsed).toBeLessThan(4_000)
  })

  it('skip advances so the next queued item can play', async () => {
    await seed('s1')
    await seed('s2', { userId: 'u2' })
    await fake.collection('system').doc('settings').set({ skipToken: 't0' })
    const queue = new BroadcastQueue(db, cfg, silent)
    const first = (await queue.claimNext())!
    const playing = playItem(deps(), first, 't0', new AbortController().signal)
    await sleep(80)
    await fake.collection('system').doc('settings').set({ skipToken: 't1' }, { merge: true })
    expect((await playing).outcome).toBe('skipped')
    await queue.finish(first, 'skipped')
    expect(fake.peek(`broadcast_queue/${first.id}`)).toMatchObject({ status: 'skipped' })
    expect(fake.peek(`submissions/${first.id}`)).toMatchObject({ status: 'skipped' })
    expect(String(fake.peek(`submissions/${first.id}`)?.status || '')).not.toBe('broadcast')

    const second = (await queue.claimNext())!
    expect(second.id).not.toBe(first.id)
    const { outcome } = await playItem(deps(), second, 't1', new AbortController().signal)
    expect(outcome).toBe('completed')
    await queue.finish(second, outcome)
    expect(fake.peek(`broadcast_queue/${second.id}`)).toMatchObject({ status: 'played' })
  })

  it('resume after pause reclaims the interrupted item', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const first = (await queue.claimNext())!
    const playing = playItem(deps(), first, undefined, new AbortController().signal)
    await sleep(80)
    await fake.collection('system').doc('settings').set({ ugcPaused: true }, { merge: true })
    expect((await playing).outcome).toBe('interrupted')
    await queue.finish(first, 'interrupted')
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'approved' })

    await fake.collection('system').doc('settings').set({ ugcPaused: false }, { merge: true })
    const again = (await queue.claimNext())!
    expect(again.id).toBe('s1')
    const { outcome } = await playItem(deps(), again, undefined, new AbortController().signal)
    expect(outcome).toBe('completed')
    await queue.finish(again, outcome)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'played', result: 'played_dry_run' })
  })

  it('graceful external abort (Ctrl+C) interrupts and requeues without broadcast', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const ac = new AbortController()
    const playing = playItem(deps(), item, undefined, ac.signal)
    await sleep(80)
    ac.abort()
    const { outcome } = await playing
    expect(outcome).toBe('interrupted')
    await queue.finish(item, outcome)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued', result: 'interrupted' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'approved' })
  })

  it('record mode refuses completed when the encoder is down before play', async () => {
    cfg = loadConfig({
      BROADCAST_MODE: 'record',
      BROADCAST_RECORD_FILE: path.join(workDir, 'unused.flv'),
      BROADCAST_HOLD_MS: '1000',
      BROADCAST_FPS: '50',
      BROADCAST_WORK_DIR: workDir,
    })
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const { outcome, error } = await playItem({
      ...deps(),
      recordingOk: () => false,
      recordingError: () => 'Recording encoder is not available',
    }, item, undefined, new AbortController().signal)
    expect(outcome).toBe('failed')
    expect(error).toMatch(/Recording encoder/i)
    await queue.finish(item, outcome, error)
    expect(fake.peek('broadcast_queue/s1')).not.toMatchObject({ status: 'played', result: 'played_record' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'approved' })
  })

  it('only one of two concurrent claimNext calls wins the same item', async () => {
    await seed('s1')
    const a = new BroadcastQueue(db, cfg, silent)
    const b = new BroadcastQueue(db, { ...cfg, workerId: 'other-worker' }, silent)
    const [x, y] = await Promise.all([a.claimNext(), b.claimNext()])
    const won = [x, y].filter(Boolean)
    expect(won).toHaveLength(1)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'playing' })
  })

  it('revoked items never return to the queue after cancel', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const playing = playItem(deps(), item, undefined, new AbortController().signal)
    await sleep(80)
    await fake.collection('submissions').doc(item.id).update({ status: 'revoked' })
    await fake.collection('broadcast_queue').doc(item.id).set({ status: 'cancelled' }, { merge: true })
    expect((await playing).outcome).toBe('cancelled')
    await queue.finish(item, 'cancelled')
    expect(fake.peek(`broadcast_queue/${item.id}`)).toMatchObject({ status: 'cancelled' })
    expect(fake.peek(`submissions/${item.id}`)).toMatchObject({ status: 'revoked' })

    // Attacker/operator requeues the cancelled row; claim must cancel again, not play.
    await fake.collection('broadcast_queue').doc(item.id).set({
      submissionId: item.id, userId: 'u1', type: 'text', status: 'queued',
      createdAt: Timestamp.fromMillis(Date.now() - 1),
    }, { merge: true })
    expect(await queue.claimNext()).toBeNull()
    expect(fake.peek(`broadcast_queue/${item.id}`)).toMatchObject({ status: 'cancelled' })
    expect(fake.peek(`submissions/${item.id}`)).toMatchObject({ status: 'revoked' })
  })

  it('skip outcome against a revoked submission does not write broadcast/skipped over revoke', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    await fake.collection('submissions').doc('s1').update({ status: 'revoked' })
    // Worker still finishes as skipped if watch raced; fencing on submission status.
    await queue.finish(item, 'skipped')
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'revoked' })
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'skipped' })
  })

  it('retries a failed item later and does not hand it out before its backoff', async () => {
    await seed('s1', { type: 'image', storagePath: 'submissions/s1/original', mimeType: 'image/png' })
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    const broken = () => {
      const r = new Readable({ read() {} })
      setImmediate(() => r.destroy(new Error('No such object')))
      return r
    }
    const { outcome, error } = await playItem(deps(broken), item, undefined, new AbortController().signal)
    expect(outcome).toBe('failed')
    expect(error).toMatch(/No such object/)
    await queue.finish(item, outcome, error)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued', result: 'retry_scheduled' })
    expect(await queue.claimNext()).toBeNull() // still in backoff
  })

  it('requeues items a crashed worker left playing', async () => {
    await seed('s1')
    await fake.collection('broadcast_queue').doc('s1').set({ status: 'playing', claimId: 'dead', attempts: 1 }, { merge: true })
    await fake.collection('system').doc('settings').set({ currentSubmissionId: 's1' })
    const queue = new BroadcastQueue(db, cfg, silent)
    expect(await queue.recoverOrphans()).toBe(1)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued', claimId: null })
    expect(fake.peek('system/settings')).toMatchObject({ currentSubmissionId: null })
  })

  it('a late finish from a stale worker cannot overwrite a recovered item', async () => {
    await seed('s1')
    const queue = new BroadcastQueue(db, cfg, silent)
    const item = (await queue.claimNext())!
    await queue.recoverOrphans() // a new worker took over and requeued it
    expect(await queue.finish(item, 'completed')).toBe(false)
    expect(fake.peek('broadcast_queue/s1')).toMatchObject({ status: 'queued' })
    expect(fake.peek('submissions/s1')).toMatchObject({ status: 'approved' })
  })
})

describe('worker lease', () => {
  it('allows one active worker; others wait until the lease expires', async () => {
    const a = new WorkerLease(db, { ...cfg, workerId: 'A' }, silent)
    const b = new WorkerLease(db, { ...cfg, workerId: 'B' }, silent)
    expect((await a.acquire()).acquired).toBe(true)
    expect(await b.acquire()).toEqual({ acquired: false, holder: 'A' })

    await fake.collection('system').doc('broadcast_worker').update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) })
    expect((await b.acquire()).acquired).toBe(true)
  })

  it('notices when another worker has taken the lease', async () => {
    const a = new WorkerLease(db, { ...cfg, workerId: 'A', leaseRenewMs: 20 }, silent)
    await a.acquire()
    let lostReason = ''
    a.startRenewing((r) => { lostReason = r })
    await fake.collection('system').doc('broadcast_worker').set({ ownerId: 'B', expiresAt: Timestamp.fromMillis(Date.now() + 60_000) })
    await sleep(100)
    expect(lostReason).toMatch(/another worker/)
    expect(a.held).toBe(false)
  })

  it('releases only its own lease', async () => {
    const a = new WorkerLease(db, { ...cfg, workerId: 'A' }, silent)
    await a.acquire()
    await fake.collection('system').doc('broadcast_worker').set({ ownerId: 'B' })
    await a.release()
    expect(fake.peek('system/broadcast_worker')).toMatchObject({ ownerId: 'B' })
  })
})
