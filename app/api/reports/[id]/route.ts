import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req)
    if (!isModerator(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await ctx.params
    const body = await req.json()
    const status = body?.status
    if (!['resolved', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const ref = db.collection('reports').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    await ref.update({
      status,
      resolvedBy: actor.uid,
      resolvedAt: FieldValue.serverTimestamp(),
      notes: typeof body?.notes === 'string' ? body.notes.slice(0, 1000) : '',
    })
    await db.collection('audit_logs').add({
      actorUid: actor.uid,
      action: `report_${status}`,
      targetId: id,
      createdAt: FieldValue.serverTimestamp(),
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not update report' }, { status: e.status || 500 })
  }
}
