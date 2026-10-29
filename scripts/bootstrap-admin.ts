import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, db } from '../lib/firebase/admin'

async function main() {
  const uid = process.env.FIREBASE_BOOTSTRAP_ADMIN_UID
  if (!uid) {
    throw new Error('Set FIREBASE_BOOTSTRAP_ADMIN_UID to the verified Firebase Auth UID of the first administrator.')
  }
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
  console.log(`Administrator role assigned to UID ${uid}. Sign out and sign in again to refresh the ID token.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
