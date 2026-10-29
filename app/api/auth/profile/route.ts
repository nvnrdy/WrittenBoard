import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '@/lib/firebase/admin'
import { requireUser } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const ref = db.collection('profiles').doc(user.uid)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) {
        tx.create(ref, {
          uid: user.uid,
          email: user.email || null,
          displayName: '',
          role: 'user',
          createdAt: FieldValue.serverTimestamp(),
          nicknameChangedAt: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not create profile' }, { status: e.status || 500 })
  }
}
