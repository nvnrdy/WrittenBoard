'use client'
import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { firebaseClient } from '@/lib/firebase/client'

type Submission = { id: string; type?: string; status?: string; createdAt?: string | null }

export default function ProfileClient({
  user,
  profile,
  submissions,
}: {
  user: { uid: string; email?: string | null }
  profile: { displayName?: string; nicknameChangedAt?: string | null } | null
  submissions: Submission[]
}) {
  const [nickname, setNickname] = useState(profile?.displayName || '')
  const [msg, setMsg] = useState('')

  async function saveNickname() {
    setMsg('Saving...')
    try {
      const token = await firebaseClient().auth.currentUser?.getIdToken()
      if (!token) throw new Error('Sign in again')
      const res = await fetch('/api/profile/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: nickname }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not save nickname')
      setMsg('Saved')
      location.reload()
    } catch (e: any) {
      setMsg(e.message || 'Could not save nickname')
    }
  }

  async function logout() {
    await signOut(firebaseClient().auth)
    await fetch('/api/auth/session', { method: 'DELETE' })
    location.href = '/'
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">Profile</h1>
      <div className="rounded border bg-white p-4">
        <p className="text-sm">Email: {user.email} (private)</p>
        <div className="mt-3 flex gap-2">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Unique nickname 3-24" className="rounded border px-3 py-2 text-sm" />
          <button onClick={saveNickname} className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white">Save</button>
        </div>
        <p role="status" className="mt-2 text-xs text-zinc-500">
          {msg} {profile?.nicknameChangedAt ? `Last changed: ${profile.nicknameChangedAt}` : ''}
        </p>
      </div>
      <div className="rounded border bg-white p-4">
        <h2 className="font-medium">Your submissions</h2>
        {submissions.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No submissions yet.</p>
        ) : (
          submissions.map((s) => (
            <div key={s.id} className="mt-2 flex justify-between border-b py-2 text-sm">
              <span>{s.type} — {s.status}</span>
              <span className="text-zinc-500">{s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</span>
            </div>
          ))
        )}
      </div>
      <button onClick={logout} className="text-sm underline">Sign out</button>
    </div>
  )
}
