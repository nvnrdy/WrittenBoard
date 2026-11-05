/**
 * One-time admin bootstrap. Loads `.env.local` before Firebase Admin init so
 * credentials target the WrittenBoard project instead of ADC fallback.
 */
import {
  assertWrittenboardProject,
  loadLocalEnv,
  requireBootstrapAdminUid,
} from './bootstrap-admin-env'

loadLocalEnv()
const projectId = assertWrittenboardProject()
const uid = requireBootstrapAdminUid()

async function main() {
  // Dynamic import so Admin SDK initializes only after env is loaded/validated.
  const { FieldValue } = await import('firebase-admin/firestore')
  const { adminAuth, db } = await import('../lib/firebase/admin')

  const user = await adminAuth.getUser(uid)
  await adminAuth.setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: true, moderator: true })
  const ref = db.collection('profiles').doc(uid)
  const snap = await ref.get()
  const existing = snap.data() || {}
  await ref.set({
    uid,
    email: user.email || existing.email || null,
    displayName: existing.displayName || '',
    role: 'admin',
    updatedAt: FieldValue.serverTimestamp(),
    ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp(), nicknameChangedAt: null }),
  }, { merge: true })
  console.log(
    `Administrator role assigned on project ${projectId} to UID ${uid}. Sign out and sign in again to refresh the ID token.`,
  )
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e)
  // Never dump credential material if an error object includes env-like fields.
  console.error(message)
  process.exit(1)
})
