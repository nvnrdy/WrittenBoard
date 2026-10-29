import { redirect } from 'next/navigation'
import { Header } from '@/components/Header'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'
import { db } from '@/lib/firebase/admin'
import { serializeForClient } from '@/lib/serialize'
import AdminClient from './client'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const user = await currentUser()
  if (!user) redirect('/auth')
  if (!isModerator(user)) redirect('/')

  const [pendingSnap, queueSnap, reportsSnap] = await Promise.all([
    db.collection('submissions').where('status', '==', 'pending_moderation').orderBy('createdAt', 'asc').limit(50).get(),
    db.collection('broadcast_queue').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(50).get(),
    db.collection('reports').where('status', '==', 'open').orderBy('createdAt', 'asc').limit(50).get(),
  ])

  return (
    <div>
      <Header user={{ id: user.uid, email: user.email }} isStaff />
      <AdminClient
        user={{ uid: user.uid, email: user.email }}
        role={user.admin ? 'admin' : 'moderator'}
        pending={pendingSnap.docs.map((d) => serializeForClient({ id: d.id, ...d.data() }))}
        queue={queueSnap.docs.map((d) => serializeForClient({ id: d.id, ...d.data() }))}
        reports={reportsSnap.docs.map((d) => serializeForClient({ id: d.id, ...d.data() }))}
      />
    </div>
  )
}
