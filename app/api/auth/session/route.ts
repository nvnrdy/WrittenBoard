import { NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import {
  SESSION_COOKIE,
  assertSameOrigin,
  currentUser,
  logAuthReject,
  type AuthRejectReason,
} from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

type AuthErr = { status?: number; reason?: AuthRejectReason; message?: string; code?: string }

export async function POST(req: Request) {
  try {
    assertSameOrigin(req)
    const body = await req.json().catch(() => null)
    const idToken = body && typeof body === 'object' ? (body as { idToken?: unknown }).idToken : undefined
    if (typeof idToken !== 'string' || !idToken || idToken.length > 10000) {
      logAuthReject('POST /api/auth/session', 'invalid_token_shape', {
        hasToken: typeof idToken === 'string',
        tokenLength: typeof idToken === 'string' ? idToken.length : 0,
      })
      return NextResponse.json({ error: 'Invalid token', reason: 'invalid_token_shape' }, { status: 400 })
    }

    let decoded
    try {
      decoded = await adminAuth.verifyIdToken(idToken, true)
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code || '') : ''
      logAuthReject('POST /api/auth/session', 'token_verify_failed', {
        firebaseCode: code || 'unknown',
      })
      return NextResponse.json({ error: 'Could not establish session', reason: 'token_verify_failed' }, { status: 401 })
    }

    try {
      const cookie = await adminAuth.createSessionCookie(idToken, { expiresIn: 5 * 24 * 60 * 60 * 1000 })
      const response = NextResponse.json({ ok: true, uid: decoded.uid })
      response.cookies.set(SESSION_COOKIE, cookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 5 * 24 * 60 * 60,
      })
      return response
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code || '') : ''
      logAuthReject('POST /api/auth/session', 'session_cookie_failed', {
        firebaseCode: code || 'unknown',
      })
      return NextResponse.json({ error: 'Could not establish session', reason: 'session_cookie_failed' }, { status: 401 })
    }
  } catch (e: unknown) {
    const err = e as AuthErr
    const status = typeof err.status === 'number' ? err.status : 401
    const reason = err.reason
    if (reason) {
      // assertSameOrigin already logged
    } else {
      logAuthReject('POST /api/auth/session', 'token_verify_failed', { unexpected: true })
    }
    return NextResponse.json(
      { error: err.status ? err.message : 'Could not establish session', ...(reason ? { reason } : {}) },
      { status },
    )
  }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req)
    const user = await currentUser()
    if (user) {
      try { await adminAuth.revokeRefreshTokens(user.uid) } catch { /* best effort */ }
    }
    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return response
  } catch (e: unknown) {
    const err = e as AuthErr
    return NextResponse.json(
      { error: err.status ? err.message : 'Could not end session', ...(err.reason ? { reason: err.reason } : {}) },
      { status: err.status || 500 },
    )
  }
}
