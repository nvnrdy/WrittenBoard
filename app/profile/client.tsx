'use client'
import { useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { firebaseClient } from '@/lib/firebase/client'
import { initAppCheck } from '@/lib/firebase/app-check'
import { AppHeader } from '@/components/app-shell/AppHeader'
import { submissionStatusLabel, submissionStatusTone } from '@/lib/submissions/status-label'
import '@/components/app-shell/app-shell.css'

type Submission = { id: string; type?: string; status?: string; createdAt?: string | null }

export default function ProfileClient({
  user,
  profile,
  submissions,
  isStaff,
}: {
  user: { uid: string; email?: string | null }
  profile: { displayName?: string; nicknameChangedAt?: string | null } | null
  submissions: Submission[]
  isStaff?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(profile?.displayName || '')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const publicName = profile?.displayName || nickname || '—'

  useEffect(() => { void initAppCheck() }, [])

  async function saveNickname() {
    setBusy(true)
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
      if (!res.ok) throw new Error(j.error || 'Could not save username')
      setMsg('Username updated')
      setEditing(false)
      location.reload()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Could not save username')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await signOut(firebaseClient().auth)
    } catch { /* client may already be signed out */ }
    await fetch('/api/auth/session', { method: 'DELETE' })
    location.href = '/'
  }

  return (
    <div className="wa">
      <AppHeader signedIn isStaff={isStaff} />
      <main className="wa-main" style={{ maxWidth: 720 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 32 }}>Profile</h1>
        <p className="wa-lead">Your public name appears with approved submissions on WrittenBoard.</p>

        <section className="wa-card" style={{ marginTop: 20 }} aria-labelledby="identity-title">
          <p className="wa-muted" id="identity-title" style={{ margin: 0 }}>Your public name</p>
          <h2 className="wa-username">{publicName}</h2>
          <p className="wa-privacy">
            This name can appear on the livestream. Your email stays private and is never shown as your public name.
          </p>

          {!editing ? (
            <div className="wa-row" style={{ marginTop: 16 }}>
              <button type="button" className="wa-btn" onClick={() => { setEditing(true); setMsg('') }}>
                Change username
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div className="wa-field">
                <label htmlFor="nickname">New username</label>
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="3–24 letters, numbers, _ . -"
                  autoComplete="off"
                />
              </div>
              <div className="wa-row">
                <button type="button" className="wa-btn wa-btn-primary" disabled={busy} onClick={saveNickname}>
                  Save username
                </button>
                <button type="button" className="wa-btn" disabled={busy} onClick={() => { setEditing(false); setNickname(profile?.displayName || ''); setMsg('') }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p role="status" className="wa-status">
            {msg}
            {!msg && profile?.nicknameChangedAt
              ? `Last changed ${new Date(profile.nicknameChangedAt).toLocaleString()}`
              : ''}
          </p>
        </section>

        <section className="wa-card" style={{ marginTop: 16 }} aria-labelledby="subs-title">
          <h2 id="subs-title" style={{ margin: 0, fontSize: 20 }}>Your submissions</h2>
          {submissions.length === 0 ? (
            <p className="wa-muted" style={{ marginTop: 12 }}>No submissions yet. When you submit, they will show up here after review.</p>
          ) : (
            <div className="wa-list">
              {submissions.map((s) => {
                const tone = submissionStatusTone(s.status)
                return (
                  <article key={s.id} className="wa-item">
                    <div>
                      <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{s.type || 'submission'}</div>
                      <div className="wa-muted" style={{ marginTop: 4 }}>
                        {s.createdAt ? new Date(s.createdAt).toLocaleString() : 'Date unavailable'}
                      </div>
                    </div>
                    <span className={tone === 'neutral' ? 'wa-badge' : `wa-badge wa-badge-${tone}`}>
                      {submissionStatusLabel(s.status)}
                    </span>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="wa-card" style={{ marginTop: 16 }} aria-labelledby="account-title">
          <h2 id="account-title" style={{ margin: 0, fontSize: 20 }}>Account</h2>
          <p className="wa-privacy">Signed in privately{user.email ? ` as ${user.email}` : ''}.</p>
          <button type="button" className="wa-btn" style={{ marginTop: 14 }} onClick={logout}>
            Sign out
          </button>
        </section>
      </main>
    </div>
  )
}
