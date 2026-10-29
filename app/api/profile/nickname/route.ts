import { NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { requireUser } from '@/lib/firebase/server-auth'
import { nicknameSchema } from '@/lib/validation'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json()
    const parsed = nicknameSchema.safeParse(body?.display_name)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Nickname must be 3–24 characters and use letters, numbers, _, . or -.' }, { status: 400 })
    }
    const nickname = parsed.data
    const key = nickname.toLowerCase()
    const profileRef = db.collection('profiles').doc(user.uid)
    const nameRef = db.collection('nicknames').doc(key)

    await db.runTransaction(async (tx) => {
      const [profile, name] = await Promise.all([tx.get(profileRef), tx.get(nameRef)])
      if (name.exists && name.data()?.uid !== user.uid) {
        throw Object.assign(new Error('Nickname is already taken'), { status: 409 })
      }
      const now = Timestamp.now()
      const last = profile.data()?.nicknameChangedAt as Timestamp | undefined
      if (last && now.toMillis() - last.toMillis() < 7 * 24 * 60 * 60 * 1000 && profile.data()?.displayName) {
        throw Object.assign(new Error('Nicknames can only be changed every 7 days'), { status: 429 })
      }
      const oldKey = String(profile.data()?.displayName || '').toLowerCase()
      if (oldKey && oldKey !== key) {
        const oldRef = db.collection('nicknames').doc(oldKey)
        const oldSnap = await tx.get(oldRef)
        if (oldSnap.exists && oldSnap.data()?.uid === user.uid) tx.delete(oldRef)
      }
      tx.set(nameRef, { uid: user.uid, createdAt: FieldValue.serverTimestamp() })
      tx.set(profileRef, {
        uid: user.uid,
        email: user.email || null,
        displayName: nickname,
        nicknameChangedAt: FieldValue.serverTimestamp(),
        role: profile.data()?.role || 'user',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })

    return NextResponse.json({ ok: true, display_name: nickname })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not update nickname' }, { status: e.status || 500 })
  }
}
