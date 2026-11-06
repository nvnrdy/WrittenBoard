/**
 * Pure state transitions for finishing a queue item. Kept free of Firestore so
 * the rules (never resurrect revoked content, bounded retries, fencing by claim)
 * can be unit tested.
 */
import type { BroadcastMode } from './config'

/**
 * completed   - the item played to the end
 * skipped     - a moderator pressed Skip while it was on air
 * cancelled   - it was revoked/rejected (or its queue entry cancelled) before or while on air
 * interrupted - the worker stopped (shutdown, UGC paused, lease lost); requeue without penalty
 * failed      - rendering, download or decoding failed
 */
export type PlayOutcome = 'completed' | 'skipped' | 'cancelled' | 'interrupted' | 'failed'

export interface FinishInput {
  outcome: PlayOutcome
  mode: BroadcastMode
  claimId: string
  maxAttempts: number
  now: number
  error?: string | null
  queue: { exists: boolean; status?: string; claimId?: string | null; attempts?: number }
  submission: { exists: boolean; status?: string }
}

export interface FinishPlan {
  /** False when this worker no longer owns the item; nothing is written. */
  owned: boolean
  queueUpdate: Record<string, unknown> | null
  submissionUpdate: Record<string, unknown> | null
  /** Whether this counts as the last played item for fairness rotation. */
  aired: boolean
}

export function retryDelayMs(attempts: number) {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1))
}

function completedResult(mode: BroadcastMode) {
  if (mode === 'rtmp') return { queueResult: 'broadcast', submissionStatus: 'broadcast' }
  if (mode === 'record') return { queueResult: 'played_record', submissionStatus: null }
  // OBS accepted a local presentation — never treat that as a verified YouTube broadcast.
  if (mode === 'obs') return { queueResult: 'played_obs', submissionStatus: null }
  return { queueResult: 'played_dry_run', submissionStatus: 'broadcast_dry_run' }
}

export function planFinish(input: FinishInput): FinishPlan {
  const { queue, submission, outcome } = input

  // Fencing: if the queue entry was cancelled (revoke/reject), recovered by another
  // worker, or re-claimed, this worker must not write anything.
  if (!queue.exists || queue.status !== 'playing' || queue.claimId !== input.claimId) {
    return { owned: false, queueUpdate: null, submissionUpdate: null, aired: false }
  }

  const attempts = Number(queue.attempts || 0)
  const stillApproved = submission.exists && submission.status === 'approved'
  const release = { claimId: null, claimedBy: null, updatedAt: '__serverTimestamp__' }
  const error = input.error ? String(input.error).slice(0, 500) : null

  if (outcome === 'completed' || outcome === 'skipped') {
    const done = outcome === 'completed' ? completedResult(input.mode) : { queueResult: 'skipped', submissionStatus: 'skipped' }
    return {
      owned: true,
      aired: true,
      queueUpdate: { ...release, status: outcome === 'completed' ? 'played' : 'skipped', result: done.queueResult, finishedAt: '__serverTimestamp__' },
      // Only an item that is still approved may change status. A revoked item stays revoked.
      submissionUpdate: stillApproved
        ? {
            lastBroadcastResult: done.queueResult,
            updatedAt: '__serverTimestamp__',
            ...(done.submissionStatus ? { status: done.submissionStatus } : {}),
          }
        : null,
    }
  }

  if (outcome === 'cancelled') {
    return {
      owned: true,
      aired: false,
      queueUpdate: { ...release, status: 'cancelled', result: 'aborted_not_approved', finishedAt: '__serverTimestamp__' },
      submissionUpdate: null,
    }
  }

  if (outcome === 'interrupted') {
    return {
      owned: true,
      aired: false,
      // The claim already counted an attempt; give it back.
      queueUpdate: { ...release, status: 'queued', attempts: Math.max(0, attempts - 1), result: 'interrupted' },
      submissionUpdate: null,
    }
  }

  // failed
  if (attempts >= input.maxAttempts || !stillApproved) {
    return {
      owned: true,
      aired: false,
      queueUpdate: { ...release, status: 'failed', result: 'failed', lastError: error, finishedAt: '__serverTimestamp__' },
      submissionUpdate: stillApproved
        ? { lastBroadcastResult: 'failed', updatedAt: '__serverTimestamp__' }
        : null,
    }
  }
  return {
    owned: true,
    aired: false,
    queueUpdate: {
      ...release,
      status: 'queued',
      result: 'retry_scheduled',
      lastError: error,
      notBefore: input.now + retryDelayMs(attempts),
    },
    submissionUpdate: null,
  }
}

/** What to do with an item found in `playing` when a worker takes over the lease. */
export function planRecovery(attempts: number, maxAttempts: number): Record<string, unknown> {
  const base = { claimId: null, claimedBy: null, updatedAt: '__serverTimestamp__' }
  return attempts >= maxAttempts
    ? { ...base, status: 'failed', result: 'failed_after_worker_crash', finishedAt: '__serverTimestamp__' }
    : { ...base, status: 'queued', result: 'recovered_after_worker_crash' }
}
