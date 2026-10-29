import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { db, getBucket } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req)
    if (!isModerator(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await req.json()
    const id = body?.submission_id
    const action = body?.action
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : ''
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid moderation request' }, { status: 400 })
    }
    if (!['approve', 'reject', 'revoke', 'mark_media_reviewed'].includes(action)) {
      return NextResponse.json({ error: 'Invalid moderation request' }, { status: 400 })
    }

    const ref = db.collection('submissions').doc(id)
    let shouldDeleteMedia = false

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw Object.assign(new Error('Submission not found'), { status: 404 })
      const current = snap.data()!

      if (action === 'mark_media_reviewed') {
        if (current.type === 'text') throw Object.assign(new Error('Text submissions do not need media review'), { status: 400 })
        if (!current.storagePath) throw Object.assign(new Error('Submission has no media'), { status: 400 })
        let durationSeconds = current.durationSeconds
        if (typeof body?.durationSeconds === 'number' && body.durationSeconds > 0 && body.durationSeconds <= 15) {
          durationSeconds = body.durationSeconds
        }
        if (current.type === 'video' && !(typeof durationSeconds === 'number' && durationSeconds <= 15)) {
          throw Object.assign(new Error('Provide a verified durationSeconds (<=15) after previewing the video'), { status: 409 })
        }
        tx.update(ref, {
          mediaReviewedAt: FieldValue.serverTimestamp(),
          mediaReviewedBy: actor.uid,
          ...(durationSeconds != null ? { durationSeconds } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        const audit = db.collection('audit_logs').doc()
        tx.create(audit, {
          actorUid: actor.uid,
          action: 'submission_media_reviewed',
          submissionId: id,
          reason,
          createdAt: FieldValue.serverTimestamp(),
        })
        return
      }

      if (action === 'approve') {
        if (current.status !== 'pending_moderation') throw Object.assign(new Error('Only pending submissions can be approved'), { status: 409 })
        if (current.type !== 'text' && !current.mediaReviewedAt) {
          throw Object.assign(new Error('Preview and mark media as reviewed before approving'), { status: 409 })
        }
        if (current.type === 'video' && !(typeof current.durationSeconds === 'number' && current.durationSeconds <= 15)) {
          throw Object.assign(new Error('Video approval requires verified duration of 15 seconds or less'), { status: 409 })
        }
      }
      if (action === 'reject' && current.status !== 'pending_moderation') {
        throw Object.assign(new Error('Only pending submissions can be rejected'), { status: 409 })
      }
      if (action === 'revoke' && current.status !== 'approved' && current.status !== 'broadcast' && current.status !== 'broadcast_dry_run') {
        throw Object.assign(new Error('Only approved or broadcast content can be revoked'), { status: 409 })
      }

      const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked'
      shouldDeleteMedia = action === 'reject' || action === 'revoke'
      tx.update(ref, {
        status,
        moderatedBy: actor.uid,
        moderatedAt: FieldValue.serverTimestamp(),
        moderationReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      })
      const audit = db.collection('audit_logs').doc()
      tx.create(audit, {
        actorUid: actor.uid,
        action: `submission_${action}`,
        submissionId: id,
        reason,
        createdAt: FieldValue.serverTimestamp(),
      })
      const q = db.collection('broadcast_queue').doc(id)
      if (action === 'approve') {
        tx.set(q, {
          submissionId: id,
          userId: current.userId,
          type: current.type,
          displayName: current.displayName,
          storagePath: current.storagePath || null,
          contentText: current.contentText || null,
          status: 'queued',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } else {
        tx.set(q, { submissionId: id, status: 'cancelled', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      }
    })

    if (shouldDeleteMedia) {
      try {
        const snap = await ref.get()
        const path = snap.data()?.storagePath
        if (path) {
          await getBucket().file(path).delete({ ignoreNotFound: true })
          await ref.update({ storagePath: null, mediaPurgedAt: FieldValue.serverTimestamp() })
        }
      } catch { /* best effort cleanup */ }
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Moderation action failed' }, { status: e.status || 500 })
  }
}
