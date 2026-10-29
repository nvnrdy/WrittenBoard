import { cookies } from 'next/headers'
import { adminAuth } from './admin'
import type { DecodedIdToken } from 'firebase-admin/auth'

export const SESSION_COOKIE = '__session'

export async function currentUser(): Promise<DecodedIdToken | null> {
  const jar = await cookies()
  const value = jar.get(SESSION_COOKIE)?.value
  if (!value) return null
  try {
    return await adminAuth.verifySessionCookie(value, true)
  } catch {
    return null
  }
}

export async function requireBearer(req: Request) {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer (.+)$/i)
  if (!match) throw Object.assign(new Error('Authentication required'), { status: 401 })
  try {
    return await adminAuth.verifyIdToken(match[1], true)
  } catch {
    throw Object.assign(new Error('Invalid authentication token'), { status: 401 })
  }
}

/** Prefer bearer token when present; otherwise fall back to the HttpOnly session cookie. */
export async function requireUser(req: Request) {
  const header = req.headers.get('authorization') || ''
  if (/^Bearer /i.test(header)) return requireBearer(req)
  const user = await currentUser()
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return user
}

export function isModerator(user: DecodedIdToken) {
  return user.admin === true || user.moderator === true
}

export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (!origin) throw Object.assign(new Error('Missing origin'), { status: 403 })
  if (origin !== new URL(req.url).origin) throw Object.assign(new Error('Invalid origin'), { status: 403 })
}
