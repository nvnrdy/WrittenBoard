import { redirect } from 'next/navigation'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'
import { db } from '@/lib/firebase/admin'
import SubmitClient from './client'

export const dynamic = 'force-dynamic'

export default async function SubmitPage() {
  const user = await currentUser()
  if (!user) redirect('/auth')
  const profile = await db.collection('profiles').doc(user.uid).get()
  if (!profile.data()?.displayName) redirect('/profile')
  return <SubmitClient isStaff={isModerator(user)} />
}
