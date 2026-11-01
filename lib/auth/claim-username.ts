import { FieldValue } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { generatePublicUsername } from '@/lib/auth/public-username'
import { nicknameSchema } from '@/lib/validation'

type ClaimResult = { displayName: string; created: boolean; assigned: boolean }

/**
 * Ensures a profile exists with a unique public displayName.
 * - New profiles get an auto-generated username.
 * - Existing profiles with a non-empty displayName are left untouched.
 * - Existing profiles with an empty displayName get a one-time generated name.
 * Never copies email or Google display names.
 */
export async function ensureProfileWithPublicUsername(input: {
  uid: string
  email?: string | null
}): Promise<ClaimResult> {
  const profileRef = db.collection('profiles').doc(input.uid)

  const existing = await profileRef.get()
  if (existing.exists) {
    const current = String(existing.data()?.displayName || '').trim()
    if (current) {
      return { displayName: current, created: false, assigned: false }
    }
  }

  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = generatePublicUsername()
    const parsed = nicknameSchema.safeParse(candidate)
    if (!parsed.success) continue
    const displayName = parsed.data
    const key = displayName.toLowerCase()
    const nameRef = db.collection('nicknames').doc(key)

    try {
      await db.runTransaction(async (tx) => {
        const [profile, name] = await Promise.all([tx.get(profileRef), tx.get(nameRef)])
        if (profile.exists) {
          const current = String(profile.data()?.displayName || '').trim()
          if (current) {
            // Another request won the race with a real name — keep it.
            throw Object.assign(new Error('already_named'), { code: 'already_named', displayName: current })
          }
        }
        if (name.exists && name.data()?.uid !== input.uid) {
          throw Object.assign(new Error('taken'), { code: 'taken' })
        }

        tx.set(nameRef, { uid: input.uid, createdAt: FieldValue.serverTimestamp() }, { merge: true })
        if (!profile.exists) {
          tx.create(profileRef, {
            uid: input.uid,
            email: input.email || null,
            displayName,
            role: 'user',
            createdAt: FieldValue.serverTimestamp(),
            nicknameChangedAt: null,
            updatedAt: FieldValue.serverTimestamp(),
          })
        } else {
          tx.set(profileRef, {
            displayName,
            email: input.email || null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        }
      })
      return { displayName, created: !existing.exists, assigned: true }
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code || '') : ''
      if (code === 'already_named') {
        const name = typeof err === 'object' && err && 'displayName' in err
          ? String((err as { displayName?: string }).displayName || '')
          : ''
        return { displayName: name, created: false, assigned: false }
      }
      if (code === 'taken') continue
      throw err
    }
  }

  throw Object.assign(new Error('Could not allocate a unique public username'), { status: 503 })
}
