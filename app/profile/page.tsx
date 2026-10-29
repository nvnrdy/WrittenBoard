import { redirect } from 'next/navigation'
import { Header } from '@/components/Header'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'
import { db } from '@/lib/firebase/admin'
import { serializeForClient } from '@/lib/serialize'
import ProfileClient from './client'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await currentUser()
  if (!user) redirect('/auth')
  const profileSnap = await db.collection('profiles').doc(user.uid).get()
  const profile = profileSnap.exists
    ? serializeForClient(profileSnap.data() as { displayName?: string; nicknameChangedAt?: unknown })
    : null
  const subsSnap = await db.collection('submissions').where('userId', '==', user.uid).orderBy('createdAt', 'desc').limit(50).get()
  const submissions = subsSnap.docs.map((d) => serializeForClient({ id: d.id, ...d.data() })) as Array<{
    id: string; type?: string; status?: string; createdAt?: string | null
  }>
  return (
    <div>
      <Header user={{ id: user.uid, email: user.email }} isStaff={isModerator(user)} />
      <ProfileClient
        user={{ uid: user.uid, email: user.email }}
        profile={profile as { displayName?: string; nicknameChangedAt?: string | null } | null}
        submissions={submissions}
      />
    </div>
  )
}
