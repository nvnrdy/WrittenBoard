import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req)
    if (!isModerator(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await req.json()
    const action = body?.action
    if (!['pause_ugc', 'resume_ugc', 'skip_current'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    await db.runTransaction(async (tx) => {
      const ref = db.collection('system').doc('settings')
      const snap = await tx.get(ref)
      const state = snap.data() || {}
      const update: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      }
      if (action === 'pause_ugc') update.ugcPaused = true
      if (action === 'resume_ugc') update.ugcPaused = false
      if (action === 'skip_current') {
        update.skipCurrentRequestedAt = FieldValue.serverTimestamp()
        update.skipToken = `${Date.now()}-${actor.uid}`
      }
      tx.set(ref, { ...state, ...update }, { merge: true })
      const audit = db.collection('audit_logs').doc()
      tx.create(audit, {
        actorUid: actor.uid,
        action: `broadcast_${action}`,
        createdAt: FieldValue.serverTimestamp(),
      })
    })

    return NextResponse.json({ ok: true, action })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Broadcast control failed' }, { status: e.status || 500 })
  }
}
