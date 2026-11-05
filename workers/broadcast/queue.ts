/** Firestore access for the broadcast queue: claim, finish, crash recovery. */
import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { selectNext } from '../../lib/broadcast/scheduler'
import type { WorkerConfig } from './config'
import { planFinish, planRecovery, type PlayOutcome } from './transitions'

export interface ClaimedItem {
  id: string
  claimId: string
  submissionId: string
  userId: string
  type: 'text' | 'image' | 'video'
  displayName: string
  contentText: string | null
  storagePath: string | null
  mimeType: string | null
  durationSeconds: number | null
  attempts: number
}

/** Converts plan placeholders into Firestore values. */
export function materialize(update: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(update)) {
    if (value === '__serverTimestamp__') out[key] = FieldValue.serverTimestamp()
    else if (key === 'notBefore' && typeof value === 'number') out[key] = Timestamp.fromMillis(value)
    else out[key] = value
  }
  return out
}

function toIso(value: unknown) {
  try {
    return (value as Timestamp)?.toDate?.()?.toISOString?.() || new Date(0).toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

export class BroadcastQueue {
  constructor(
    private readonly db: Firestore,
    private readonly cfg: WorkerConfig,
    private readonly log: (msg: string) => void,
  ) {}

  private queueRef(id: string) { return this.db.collection('broadcast_queue').doc(id) }
  private submissionRef(id: string) { return this.db.collection('submissions').doc(id) }
  get settingsRef() { return this.db.collection('system').doc('settings') }

  /** Picks the next fair candidate and claims it transactionally. */
  async claimNext(lastUserId?: string, lastType?: string): Promise<ClaimedItem | null> {
    const snap = await this.db.collection('broadcast_queue')
      .where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(50).get()
    const now = Date.now()
    const ready = snap.docs.filter((d) => {
      const notBefore = (d.data().notBefore as Timestamp | undefined)?.toMillis?.() ?? 0
      return notBefore <= now
    })
    const next = selectNext(
      ready.map((d) => ({
        id: d.id,
        user_id: String(d.data().userId || 'unknown'),
        type: String(d.data().type || 'text'),
        created_at: toIso(d.data().createdAt),
      })),
      { avoidSameUserStreak: 1, lastUserId, lastType },
    )
    if (!next) return null
    return this.claim(next.id)
  }

  private async claim(queueId: string): Promise<ClaimedItem | null> {
    const ref = this.queueRef(queueId)
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const q = snap.data()
      if (!snap.exists || !q || q.status !== 'queued') return null
      const submissionId = String(q.submissionId || queueId)
      const sub = await tx.get(this.submissionRef(submissionId))
      const s = sub.data()
      // Never put content on air unless the submission is still approved right now.
      if (!sub.exists || !s || s.status !== 'approved') {
        tx.update(ref, {
          status: 'cancelled',
          result: 'not_approved_at_claim',
          updatedAt: FieldValue.serverTimestamp(),
        })
        return null
      }
      const type = String(s.type || q.type || 'text')
      if (type !== 'text' && type !== 'image' && type !== 'video') {
        tx.update(ref, { status: 'failed', result: 'unknown_type', updatedAt: FieldValue.serverTimestamp() })
        return null
      }
      const claimId = randomUUID()
      const attempts = Number(q.attempts || 0) + 1
      tx.update(ref, {
        status: 'playing',
        claimId,
        claimedBy: this.cfg.workerId,
        workerMode: this.cfg.mode,
        attempts,
        playingAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        id: queueId,
        claimId,
        submissionId,
        userId: String(s.userId || q.userId || 'unknown'),
        type,
        displayName: String(s.displayName || q.displayName || 'community'),
        contentText: (s.contentText ?? q.contentText ?? null) as string | null,
        storagePath: (s.storagePath ?? q.storagePath ?? null) as string | null,
        mimeType: (s.mimeType ?? null) as string | null,
        durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : null,
        attempts,
      }
    })
  }

  /** Applies the outcome only if this worker still owns the claim. Returns whether the item aired. */
  async finish(item: ClaimedItem, outcome: PlayOutcome, error?: string | null): Promise<boolean> {
    const queueRef = this.queueRef(item.id)
    const subRef = this.submissionRef(item.submissionId)
    const aired = await this.db.runTransaction(async (tx) => {
      const [q, s] = await Promise.all([tx.get(queueRef), tx.get(subRef)])
      const plan = planFinish({
        outcome,
        mode: this.cfg.mode,
        claimId: item.claimId,
        maxAttempts: this.cfg.maxAttempts,
        now: Date.now(),
        error,
        queue: {
          exists: q.exists,
          status: q.data()?.status,
          claimId: q.data()?.claimId ?? null,
          attempts: Number(q.data()?.attempts || 0),
        },
        submission: { exists: s.exists, status: s.data()?.status },
      })
      if (!plan.owned) {
        this.log(`item ${item.id}: no longer owned by this worker (status ${q.data()?.status}); leaving it untouched`)
        return false
      }
      if (plan.queueUpdate) tx.update(queueRef, materialize(plan.queueUpdate))
      if (plan.submissionUpdate) tx.update(subRef, materialize(plan.submissionUpdate))
      return plan.aired
    })

    await this.settingsRef.set({
      currentSubmissionId: null,
      ...(aired ? { lastPlayedUserId: item.userId, lastPlayedType: item.type } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return aired
  }

  async setOnAir(item: ClaimedItem) {
    await this.settingsRef.set({
      currentSubmissionId: item.submissionId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  /**
   * Called right after taking the lease. As the only worker, anything still marked
   * `playing` belongs to a worker that died mid-item.
   */
  async recoverOrphans(): Promise<number> {
    const snap = await this.db.collection('broadcast_queue').where('status', '==', 'playing').limit(100).get()
    let recovered = 0
    for (const doc of snap.docs) {
      const changed = await this.db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref)
        if (fresh.data()?.status !== 'playing') return false
        tx.update(doc.ref, materialize(planRecovery(Number(fresh.data()?.attempts || 0), this.cfg.maxAttempts)))
        return true
      })
      if (changed) recovered++
    }
    await this.settingsRef.set({ currentSubmissionId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return recovered
  }
}
