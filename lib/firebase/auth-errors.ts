/** Safe, user-facing auth error helpers. Never log tokens or PII. */

type AuthLikeError = {
  code?: string
  message?: string
  name?: string
}

export function getFirebaseAuthCode(err: unknown): string {
  if (typeof err !== 'object' || !err) return ''
  const code = (err as AuthLikeError).code
  return typeof code === 'string' ? code : ''
}

/** Dev-only console detail: Firebase code + short message, no credentials. */
export function logAuthError(context: string, err: unknown) {
  if (process.env.NODE_ENV === 'production') return
  const code = getFirebaseAuthCode(err)
  const message =
    typeof err === 'object' && err && 'message' in err && typeof (err as AuthLikeError).message === 'string'
      ? String((err as AuthLikeError).message).slice(0, 240)
      : err instanceof Error
        ? err.message.slice(0, 240)
        : 'unknown'
  // eslint-disable-next-line no-console
  console.error(`[auth] ${context}`, { code: code || '(none)', message })
}

export function userAuthMessage(kind: 'email' | 'google', err: unknown): string {
  const code = getFirebaseAuthCode(err)
  if (kind === 'google') {
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was cancelled.'
    }
    if (code === 'auth/popup-blocked') {
      return 'Google sign-in popup was blocked. Allow popups for this site and try again.'
    }
    if (code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized for Google sign-in.'
    }
    return code
      ? `Google sign-in failed (${code}).`
      : 'Google sign-in failed. Try again, or use email sign-in.'
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Sign-in failed. Check your email and password.'
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account already exists with this email. Sign in instead.'
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 8 characters.'
  }
  return code
    ? `Sign-in failed (${code}). Check your details and try again.`
    : 'Unable to sign in. Check your details and try again.'
}
