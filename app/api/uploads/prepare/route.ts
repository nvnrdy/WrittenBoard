import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { db, getBucket } from '@/lib/firebase/admin'
import { requireUser } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

const DAY = 24 * 60 * 60 * 1000
const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm'],
} as const

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json()
    const type = body?.type as 'image' | 'video' | undefined
    const contentType = typeof body?.contentType === 'string' ? body.contentType : ''
    const size = Number(body?.size || 0)
    if (type !== 'image' && type !== 'video') {
      return NextResponse.json({ error: 'Invalid upload type' }, { status: 400 })
    }
    const allowed: readonly string[] = ALLOWED[type]
    if (!allowed.includes(contentType)) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 })
    }
    const max = type === 'image' ? 5 * 1024 * 1024 : 25 * 1024 * 1024
    if (!Number.isFinite(size) || size <= 0 || size > max) {
      return NextResponse.json({ error: 'Invalid file size' }, { status: 400 })
    }

    const profile = await db.collection('profiles').doc(user.uid).get()
    if (!profile.data()?.displayName) {
      return NextResponse.json({ error: 'Choose a nickname before uploading.' }, { status: 400 })
    }

    const now = Date.now()
    const limitRef = db.collection('rate_limits').doc(user.uid)
    await db.runTransaction(async (tx) => {
      const [rateSnap, settingsSnap] = await Promise.all([
        tx.get(limitRef),
        tx.get(db.collection('system').doc('settings')),
      ])
      if (settingsSnap.data()?.ugcPaused === true) {
        throw Object.assign(new Error('Submissions are temporarily paused'), { status: 503 })
      }
      const last = rateSnap.data()?.windowStart?.toMillis?.() || 0
      const count = last > now - DAY ? Number(rateSnap.data()?.count || 0) : 0
      if (count >= 3) throw Object.assign(new Error('Daily submission limit reached'), { status: 429 })
      const uploadCount = last > now - DAY ? Number(rateSnap.data()?.uploadPrepareCount || 0) : 0
      if (uploadCount >= 10) throw Object.assign(new Error('Too many upload attempts today'), { status: 429 })
      tx.set(limitRef, {
        windowStart: last > now - DAY ? rateSnap.data()?.windowStart : FieldValue.serverTimestamp(),
        count,
        uploadPrepareCount: uploadCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })

    const ext = contentType === 'image/jpeg' ? 'jpg' : String(contentType).split('/')[1]
    const objectPath = `pending-uploads/${user.uid}/${randomUUID()}.${ext}`
    const expires = Date.now() + 15 * 60 * 1000
    const [uploadUrl] = await getBucket().file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType,
    })

    return NextResponse.json({
      ok: true,
      storagePath: objectPath,
      uploadUrl,
      headers: { 'Content-Type': contentType },
      maxBytes: max,
      expiresAt: new Date(expires).toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not prepare upload' }, { status: e.status || 500 })
  }
}
