'use client'
import { useState } from 'react'
import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth'
import { firebaseClient } from '@/lib/firebase/client'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [msg, setMsg] = useState('')

  async function finish(user: import('firebase/auth').User) {
    const token = await user.getIdToken(true)
    const session = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })
    if (!session.ok) throw new Error('Unable to establish secure session')
    await fetch('/api/auth/profile', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    location.href = '/profile'
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setMsg('Working...')
    try {
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      const { auth } = firebaseClient()
      const credential = mode === 'signup'
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password)
      await finish(credential.user)
    } catch {
      setMsg('Unable to sign in. Check your details and Firebase Authentication settings.')
    }
  }

  async function google() {
    setMsg('Opening Google sign-in...')
    try {
      const { auth } = firebaseClient()
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await finish(result.user)
    } catch {
      setMsg('Google sign-in failed. Check your provider and authorized domains in Firebase.')
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm rounded-[20px] border bg-white p-6">
        <h1 className="text-xl font-bold">Sign in to WrittenBoard</h1>
        <button onClick={google} className="mt-4 w-full rounded-full border py-2 text-sm">Continue with Google</button>
        <div className="my-4 text-center text-xs text-zinc-500">or</div>
        <form onSubmit={handleEmail} className="space-y-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded border px-3 py-2 text-sm" required autoComplete="email" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (at least 8 characters)" type="password" minLength={8} className="w-full rounded border px-3 py-2 text-sm" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          <button className="w-full rounded-full bg-zinc-900 py-2 text-sm text-white">{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="mt-3 text-xs underline">
          {mode === 'signin' ? 'Need account? Sign up' : 'Have account? Sign in'}
        </button>
        <p role="status" className="mt-3 text-xs text-zinc-600">{msg}</p>
      </div>
    </div>
  )
}
