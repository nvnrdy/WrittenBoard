'use client'
import Link from 'next/link'
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
  const publicName = profile?.displayName || '—'

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
      <main className="wa-main wa-main-narrow">
        <p className="wa-section-label">Your profile</p>
        <h1 className="wa-page-title">Dashboard</h1>
        <p className="wa-lead">
          Manage the public name that can appear with your approved content on the WrittenBoard livestream.
        </p>

        <section className="wa-card" style={{ marginTop: 24 }} aria-labelledby="identity-title">
          <p className="wa-section-label" id="identity-title">Public username</p>
          <h2 className="wa-username">{publicName}</h2>
          <p className="wa-privacy">
            This username may appear on stream with approved submissions. Your email stays private and is never used as your public identity.
          </p>

          {!editing ? (
            <div className="wa-row" style={{ marginTop: 18 }}>
              <button type="button" className="wa-btn" onClick={() => { setEditing(true); setMsg(''); setNickname(profile?.displayName || '') }}>
                Change username
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 18 }}>
              <div className="wa-field">
                <label htmlFor="nickname">New username</label>
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="3–24 letters, numbers, _ . -"
                  autoComplete="off"
                  maxLength={24}
                  aria-describedby="nickname-hint"
                />
                <p id="nickname-hint" className="wa-field-hint">
                  Use 3–24 characters: letters, numbers, underscore, period or hyphen.
                </p>
              </div>
              <div className="wa-row">
                <button type="button" className="wa-btn wa-btn-primary" disabled={busy} onClick={saveNickname}>
                  Save username
                </button>
                <button
                  type="button"
                  className="wa-btn"
                  disabled={busy}
                  onClick={() => { setEditing(false); setNickname(profile?.displayName || ''); setMsg('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p
            role="status"
            className={`wa-status ${msg && (msg.includes('Could') || msg.includes('Sign in')) ? 'wa-status-err' : msg === 'Username updated' ? 'wa-status-ok' : ''}`}
          >
            {msg}
            {!msg && profile?.nicknameChangedAt
              ? `Last changed ${new Date(profile.nicknameChangedAt).toLocaleString()}`
              : ''}
          </p>
        </section>

        <section className="wa-card" style={{ marginTop: 16 }} aria-labelledby="subs-title">
          <h2 id="subs-title" style={{ margin: 0, fontSize: 20 }}>Your submissions</h2>
          <p className="wa-privacy" style={{ marginTop: 8 }}>
            Statuses reflect moderation and broadcast progress for content you have submitted.
          </p>
          {submissions.length === 0 ? (
            <div className="wa-empty">
              <p>No submissions yet. Share a message, image or short video for human review.</p>
              <Link href="/submit" className="wa-btn wa-btn-primary">Submit content</Link>
            </div>
          ) : (
            <div className="wa-list">
              {submissions.map((s) => {
                const tone = submissionStatusTone(s.status)
                return (
                  <article key={s.id} className="wa-sub-card">
                    <div>
                      <div className="wa-sub-type">{s.type || 'submission'}</div>
                      <div className="wa-sub-meta">
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

        <section className="wa-account" aria-labelledby="account-title">
          <h2 id="account-title">Account</h2>
          <p>
            Signed in privately{user.email ? ` as ${user.email}` : ''}.
            This email is only for account access — it is not shown on stream.
          </p>
          <button type="button" className="wa-btn" onClick={logout}>
            Sign out
          </button>
        </section>
      </main>
    </div>
  )
}
