import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'
import { reportSchema } from '@/lib/validation'

export const runtime = 'nodejs'

const DAY = 24 * 60 * 60 * 1000

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const parsed = reportSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid report details' }, { status: 400 })
    const { submission_id, reason, details } = parsed.data

    const reportLimitRef = db.collection('rate_limits').doc(`${user.uid}_reports`)
    await db.runTransaction(async (tx) => {
      const now = Date.now()
      const rateSnap = await tx.get(reportLimitRef)
      const last = rateSnap.data()?.windowStart?.toMillis?.() || 0
      const count = last > now - DAY ? Number(rateSnap.data()?.count || 0) : 0
      if (count >= 20) throw Object.assign(new Error('Report limit reached for today'), { status: 429 })

      const submission = await tx.get(db.collection('submissions').doc(submission_id))
      // Always return the same client message; only write when the target exists.
      if (!submission.exists) {
        tx.set(reportLimitRef, {
          windowStart: last > now - DAY ? rateSnap.data()?.windowStart : FieldValue.serverTimestamp(),
          count: count + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        return
      }

      const dupId = `${user.uid}_${submission_id}`
      const dupRef = db.collection('reports').doc(dupId)
      const dup = await tx.get(dupRef)
      if (!dup.exists) {
        tx.create(dupRef, {
          reporterUid: user.uid,
          submissionId: submission_id,
          reason,
          details: details || '',
          status: 'open',
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      tx.set(reportLimitRef, {
        windowStart: last > now - DAY ? rateSnap.data()?.windowStart : FieldValue.serverTimestamp(),
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })

    return NextResponse.json({ ok: true, message: 'Report received for review' })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not submit report' }, { status: e.status || 500 })
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    if (!isModerator(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const snap = await db.collection('reports').where('status', '==', 'open').orderBy('createdAt', 'asc').limit(100).get()
    return NextResponse.json({
      items: snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          submissionId: data.submissionId,
          reason: data.reason,
          details: data.details,
          reporterUid: data.reporterUid,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        }
      }),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not load reports' }, { status: e.status || 500 })
  }
}
