'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth'
import { firebaseClient } from '@/lib/firebase/client'
import { initAppCheck } from '@/lib/firebase/app-check'
import { logAuthError, userAuthMessage } from '@/lib/firebase/auth-errors'
import { AppHeader } from '@/components/app-shell/AppHeader'
import '@/components/app-shell/app-shell.css'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void initAppCheck() }, [])

  async function finish(user: import('firebase/auth').User) {
    const token = await user.getIdToken(true)
    const session = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })
    if (!session.ok) {
      const detail = await session.text().catch(() => '')
      const err = new Error(`session_failed_${session.status}`)
      logAuthError('session', { code: `session/http-${session.status}`, message: detail.slice(0, 120) })
      throw err
    }
    await fetch('/api/auth/profile', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    location.href = '/profile'
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('Working...')
    try {
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      const { auth } = firebaseClient()
      const credential = mode === 'signup'
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password)
      await finish(credential.user)
    } catch (err: unknown) {
      logAuthError(mode === 'signup' ? 'email-signup' : 'email-signin', err)
      setMsg(userAuthMessage('email', err))
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    setMsg('Opening Google sign-in...')
    try {
      const { auth } = firebaseClient()
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      await finish(result.user)
    } catch (err: unknown) {
      logAuthError('google-popup', err)
      setMsg(userAuthMessage('google', err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wa">
      <AppHeader />
      <main className="wa-main" style={{ maxWidth: 480 }}>
        <div className="wa-card">
          <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
          <p className="wa-lead">Watching is free. Sign in to submit content for the WrittenBoard livestream.</p>
          <button type="button" className="wa-btn" style={{ width: '100%', marginTop: 18 }} disabled={busy} onClick={google}>
            Continue with Google
          </button>
          <p className="wa-muted" style={{ textAlign: 'center', margin: '16px 0' }}>or</p>
          <form onSubmit={handleEmail}>
            <div className="wa-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="wa-field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />
            </div>
            <button className="wa-btn wa-btn-primary" style={{ width: '100%' }} disabled={busy}>
              {mode === 'signin' ? 'Sign In' : 'Create account'}
            </button>
          </form>
          <button type="button" className="wa-muted" style={{ marginTop: 14, background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
          <p role="status" className={`wa-status ${msg.includes('failed') || msg.includes('Unable') || msg.includes('blocked') || msg.includes('cancelled') || msg.includes('authorized') ? 'wa-status-err' : ''}`}>{msg}</p>
          <p className="wa-muted" style={{ marginTop: 18 }}>
            <Link href="/">Back to WrittenBoard</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
