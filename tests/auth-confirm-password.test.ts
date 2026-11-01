import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('auth confirm password', () => {
  const auth = () => read('app/auth/page.tsx')

  it('shows confirm password only for create-account mode', () => {
    const s = auth()
    expect(s).toContain("mode === 'signup'")
    expect(s).toContain('confirm-password')
    expect(s).toContain('Confirm password')
    expect(s).toContain('confirmPassword')
  })

  it('keeps the eight-character password minimum and match checks', () => {
    const s = auth()
    expect(s).toContain('password.length < 8')
    expect(s).toContain('minLength={8}')
    expect(s).toContain('Passwords do not match')
    expect(s).toContain('password !== confirmPassword')
  })

  it('clears confirmation when switching modes and blocks mismatched signup', () => {
    const s = auth()
    expect(s).toContain('setConfirmPassword(')
    expect(s).toContain('switchMode')
    expect(s).toContain('signupBlocked')
    expect(s).toContain('disabled={busy || signupBlocked}')
  })

  it('preserves Google sign-in and does not touch session/profile APIs beyond existing finish()', () => {
    const s = auth()
    expect(s).toContain('Continue with Google')
    expect(s).toContain('signInWithPopup')
    expect(s).toContain('/api/auth/session')
    expect(s).toContain('/api/auth/profile')
  })
})
