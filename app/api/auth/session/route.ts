import { NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { SESSION_COOKIE, assertSameOrigin, currentUser } from '@/lib/firebase/server-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    assertSameOrigin(req)
    const { idToken } = await req.json()
    if (typeof idToken !== 'string' || idToken.length > 10000) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }
    const decoded = await adminAuth.verifyIdToken(idToken, true)
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
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not establish session' }, { status: e.status || 401 })
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
  } catch (e: any) {
    return NextResponse.json({ error: e.status ? e.message : 'Could not end session' }, { status: e.status || 500 })
  }
}
