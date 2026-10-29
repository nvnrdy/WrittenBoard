import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { db, getBucket } from '@/lib/firebase/admin'
import { requireUser } from '@/lib/firebase/server-auth'
import { textSubmissionSchema } from '@/lib/validation'
import { moderateText } from '@/lib/moderation/provider'
import { assertAllowedMedia, detectMimeFromBuffer, parseMp4DurationSeconds } from '@/lib/media/signatures'

export const runtime = 'nodejs'

const DAY = 24 * 60 * 60 * 1000

export async function POST(req: Request) {
  let stagedPath: string | null = null
  try {
    const user = await requireUser(req)
    const body = await req.json()
    const type = body?.type
    if (!['text', 'image', 'video'].includes(type)) {
      return NextResponse.json({ error: 'Invalid submission type' }, { status: 400 })
    }

    const profileRef = db.collection('profiles').doc(user.uid)
    const profileSnap = await profileRef.get()
    const profile = profileSnap.data()
    if (!profile?.displayName) {
      return NextResponse.json({ error: 'Choose a nickname before submitting.' }, { status: 400 })
    }

    const id = randomUUID()
    const now = Date.now()
    const limitRef = db.collection('rate_limits').doc(user.uid)
    let contentText: string | null = null
    let storagePath: string | null = null
    let mimeType: string | null = null
    let sizeBytes: number | null = null
    let durationSeconds: number | null = null
    let moderation: { pass: boolean; error?: string | null; provider?: string } = {
      pass: false,
      error: 'Manual review required',
      provider: process.env.MODERATION_PROVIDER || 'manual',
    }

    // Reserve the daily slot BEFORE calling external moderation or touching media.
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
      tx.set(limitRef, {
        windowStart: last > now - DAY ? rateSnap.data()?.windowStart : FieldValue.serverTimestamp(),
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })

    try {
      if (type === 'text') {
        const parsed = textSubmissionSchema.safeParse({ type, content: body.content })
        if (!parsed.success) throw Object.assign(new Error('Text must contain 1–500 characters.'), { status: 400 })
        contentText = parsed.data.content
        const result = await moderateText(contentText)
        moderation = {
          pass: result.pass,
          error: result.error || (result.pass ? null : 'Flagged for manual review'),
          provider: process.env.MODERATION_PROVIDER || 'manual',
        }
      } else {
        const requestedPath = body?.storagePath
        if (typeof requestedPath !== 'string' || !requestedPath.startsWith(`pending-uploads/${user.uid}/`) || requestedPath.length > 300 || requestedPath.includes('..')) {
          throw Object.assign(new Error('Invalid upload path'), { status: 400 })
        }
        stagedPath = requestedPath
        const file = getBucket().file(requestedPath)
        const [exists] = await file.exists()
        if (!exists) throw Object.assign(new Error('Upload not found'), { status: 400 })
        const [meta] = await file.getMetadata()
        const size = Number(meta.size || 0)
        const declaredMime = String(meta.contentType || '')
        assertAllowedMedia(type, declaredMime, size)
        const [buf] = await file.download()
        const detected = detectMimeFromBuffer(buf)
        if (!detected || detected !== declaredMime) {
          throw Object.assign(new Error('File signature does not match its declared type'), { status: 400 })
        }
        if (type === 'video') {
          if (detected === 'video/mp4') {
            durationSeconds = parseMp4DurationSeconds(buf)
            if (durationSeconds == null) throw Object.assign(new Error('Could not determine video duration'), { status: 400 })
            if (durationSeconds > 15.05) throw Object.assign(new Error('Videos must be 15 seconds or shorter'), { status: 400 })
          } else {
            // WebM duration requires a demuxer; keep pending until a moderator/ffmpeg probe confirms.
            durationSeconds = null
          }
        }
        const destPath = `submissions/${id}/original`
        await file.copy(getBucket().file(destPath))
        await file.delete({ ignoreNotFound: true })
        stagedPath = null
        storagePath = destPath
        mimeType = detected
        sizeBytes = size
      }

      await db.collection('submissions').doc(id).create({
        id,
        userId: user.uid,
        displayName: profile.displayName,
        type,
        contentText,
        storagePath,
        mimeType,
        sizeBytes,
        durationSeconds,
        mediaReviewedAt: null,
        status: 'pending_moderation',
        moderation: {
          state: moderation.pass ? 'auto_pass_pending_human' : 'manual_review',
          provider: moderation.provider,
          providerError: moderation.error || null,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      return NextResponse.json({ ok: true, id, status: 'pending_moderation' }, { status: 201 })
    } catch (inner: any) {
      // Roll back the reserved daily slot on failure after reservation.
      try {
        await db.runTransaction(async (tx) => {
          const rateSnap = await tx.get(limitRef)
          const last = rateSnap.data()?.windowStart?.toMillis?.() || 0
          const count = last > now - DAY ? Number(rateSnap.data()?.count || 0) : 0
          tx.set(limitRef, {
            count: Math.max(0, count - 1),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        })
      } catch { /* best effort */ }
      if (stagedPath) {
        try { await getBucket().file(stagedPath).delete({ ignoreNotFound: true }) } catch { /* best effort */ }
      }
      throw inner
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not submit content' }, { status: e.status || 500 })
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const snap = await db.collection('submissions').where('userId', '==', user.uid).orderBy('createdAt', 'desc').limit(50).get()
    return NextResponse.json({
      items: snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          type: data.type,
          status: data.status,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        }
      }),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not load submissions' }, { status: e.status || 500 })
  }
}
