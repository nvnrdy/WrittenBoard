import { NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db, getBucket } from '@/lib/firebase/admin'
import { requireUser, isModerator } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

async function authorize(req: Request) {
  const secret = process.env.CLEANUP_JOB_SECRET
  const header = req.headers.get('x-cleanup-secret')
  if (secret && header && header === secret) return { uid: 'cleanup-job' }
  const actor = await requireUser(req)
  if (!isModerator(actor)) throw Object.assign(new Error('Forbidden'), { status: 403 })
  return { uid: actor.uid }
}

/** Deletes rejected/revoked media older than 30 days and abandoned pending uploads older than 24 hours. */
export async function POST(req: Request) {
  try {
    const actor = await authorize(req)
    const bucket = getBucket()
    const cutoffRejected = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rejected = await db.collection('submissions')
      .where('status', 'in', ['rejected', 'revoked'])
      .where('updatedAt', '<=', cutoffRejected)
      .limit(100)
      .get()

    let deletedObjects = 0
    for (const doc of rejected.docs) {
      const path = doc.data().storagePath
      if (path) {
        await bucket.file(path).delete({ ignoreNotFound: true })
        deletedObjects++
        await doc.ref.update({ storagePath: null, mediaPurgedAt: FieldValue.serverTimestamp() })
      }
    }

    const [pendingFiles] = await bucket.getFiles({ prefix: 'pending-uploads/', maxResults: 200 })
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    for (const file of pendingFiles) {
      const [meta] = await file.getMetadata()
      const created = new Date(meta.timeCreated || 0).getTime()
      if (created && created < dayAgo) {
        await file.delete({ ignoreNotFound: true })
        deletedObjects++
      }
    }

    await db.collection('audit_logs').add({
      actorUid: actor.uid,
      action: 'media_cleanup',
      meta: { deletedObjects, scannedRejected: rejected.size },
      createdAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ ok: true, deletedObjects, scannedRejected: rejected.size })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Cleanup failed' }, { status: e.status || 500 })
  }
}
