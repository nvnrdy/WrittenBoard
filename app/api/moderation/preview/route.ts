import { NextResponse } from 'next/server'
import { db, getBucket } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req)
    if (!isModerator(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await req.json()
    const id = body?.submission_id
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
    }
    const snap = await db.collection('submissions').doc(id).get()
    if (!snap.exists) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    const data = snap.data()!
    if (data.type === 'text') return NextResponse.json({ ok: true, type: 'text', contentText: data.contentText })
    if (!data.storagePath) return NextResponse.json({ error: 'No media attached' }, { status: 404 })
    const expires = Date.now() + 5 * 60 * 1000
    const [url] = await getBucket().file(data.storagePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires,
    })
    return NextResponse.json({
      ok: true,
      type: data.type,
      mimeType: data.mimeType,
      durationSeconds: data.durationSeconds ?? null,
      mediaReviewedAt: data.mediaReviewedAt?.toDate?.()?.toISOString?.() || null,
      previewUrl: url,
      expiresAt: new Date(expires).toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not create preview' }, { status: e.status || 500 })
  }
}
