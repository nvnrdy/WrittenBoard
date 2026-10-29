/**
 * Offline media cleanup entrypoint for cron / Cloud Scheduler.
 * Prefer CLEANUP_JOB_SECRET against POST /api/cleanup/media when the app is deployed.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db, getBucket } from '../lib/firebase/admin'

async function main() {
  const bucket = getBucket()
  const cutoffRejected = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const rejected = await db.collection('submissions')
    .where('status', 'in', ['rejected', 'revoked'])
    .where('updatedAt', '<=', cutoffRejected)
    .limit(200)
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

  const [pendingFiles] = await bucket.getFiles({ prefix: 'pending-uploads/', maxResults: 500 })
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  for (const file of pendingFiles) {
    const [meta] = await file.getMetadata()
    const created = new Date(meta.timeCreated || 0).getTime()
    if (created && created < dayAgo) {
      await file.delete({ ignoreNotFound: true })
      deletedObjects++
    }
  }

  console.log(JSON.stringify({ ok: true, deletedObjects, scannedRejected: rejected.size }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
