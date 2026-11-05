/**
 * Single-worker lock. Only the lease holder may claim items or push to the stream,
 * so a second worker (or a restarted container) waits as a hot standby instead of
 * double-pushing to the same stream key.
 */
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { WorkerConfig } from './config'

export const LEASE_DOC = 'broadcast_worker'

export class WorkerLease {
  private timer: NodeJS.Timeout | null = null
  private lastRenewedAt = 0
  private lost = false

  constructor(
    private readonly db: Firestore,
    private readonly cfg: WorkerConfig,
    private readonly log: (msg: string) => void,
  ) {}

  private get ref() {
    return this.db.collection('system').doc(LEASE_DOC)
  }

  get held() {
    return !this.lost && Date.now() - this.lastRenewedAt < this.cfg.leaseTtlMs
  }

  /** Takes the lease if it is free, expired, or already ours. */
  async acquire(): Promise<{ acquired: boolean; holder?: string }> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref)
      const data = snap.data()
      const expiresAt = (data?.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0
      if (data && data.ownerId !== this.cfg.workerId && expiresAt > Date.now()) {
        return { acquired: false, holder: String(data.ownerId || 'unknown') }
      }
      tx.set(this.ref, {
        ownerId: this.cfg.workerId,
        mode: this.cfg.mode,
        acquiredAt: FieldValue.serverTimestamp(),
        renewedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + this.cfg.leaseTtlMs),
      })
      this.lastRenewedAt = Date.now()
      this.lost = false
      return { acquired: true }
    })
  }

  private async renew(): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref)
      if (snap.data()?.ownerId !== this.cfg.workerId) return false
      tx.update(this.ref, {
        renewedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + this.cfg.leaseTtlMs),
      })
      return true
    })
  }

  /**
   * Renews periodically. Calls onLost if another worker took over, or if renewal
   * keeps failing until our lease would have expired (we must assume it is gone).
   */
  startRenewing(onLost: (reason: string) => void) {
    const tick = async () => {
      try {
        if (await this.renew()) this.lastRenewedAt = Date.now()
        else return this.markLost(onLost, 'another worker holds the lease')
      } catch (err) {
        this.log(`lease renewal failed: ${(err as Error).message}`)
      }
      // Stop pushing a little before the lease could be taken by someone else.
      if (Date.now() - this.lastRenewedAt > this.cfg.leaseTtlMs - this.cfg.leaseRenewMs / 2) {
        return this.markLost(onLost, 'could not renew lease in time')
      }
      this.timer = setTimeout(tick, this.cfg.leaseRenewMs)
    }
    this.timer = setTimeout(tick, this.cfg.leaseRenewMs)
  }

  private markLost(onLost: (reason: string) => void, reason: string) {
    if (this.lost) return
    this.lost = true
    this.stopRenewing()
    onLost(reason)
  }

  stopRenewing() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async release() {
    this.stopRenewing()
    try {
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(this.ref)
        if (snap.data()?.ownerId === this.cfg.workerId) tx.delete(this.ref)
      })
    } catch (err) {
      this.log(`lease release failed (it will expire): ${(err as Error).message}`)
    }
  }
}
