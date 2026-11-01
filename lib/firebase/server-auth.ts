import { cookies } from 'next/headers'
import { adminAuth } from './admin'
import type { DecodedIdToken } from 'firebase-admin/auth'

export const SESSION_COOKIE = '__session'

/** Public browser origins allowed to call cookie-mutating auth APIs. */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://writtenboard.com',
  'https://www.writtenboard.com',
  'https://writtenboard--writtenboard.asia-southeast1.hosted.app',
] as const

export type AuthRejectReason =
  | 'missing_origin'
  | 'invalid_origin_format'
  | 'origin_not_allowed'
  | 'origin_insecure'
  | 'invalid_token_shape'
  | 'token_verify_failed'
  | 'session_cookie_failed'

type AuthHttpError = Error & { status: number; reason?: AuthRejectReason }

function authError(message: string, status: number, reason: AuthRejectReason): AuthHttpError {
  return Object.assign(new Error(message), { status, reason })
}

/** Structured auth diagnostics — never log tokens, cookies, or PII. */
export function logAuthReject(
  route: string,
  reason: AuthRejectReason,
  details?: Record<string, string | number | boolean | undefined>,
) {
  const safe: Record<string, string | number | boolean> = { route, reason }
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) continue
      // Never accept keys that might carry secrets.
      if (/token|cookie|authorization|password|secret|key/i.test(key)) continue
      safe[key] = value
    }
  }
  console.warn('[auth]', JSON.stringify(safe))
}

export function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS)
  const extra = process.env.ALLOWED_ORIGINS
  if (extra) {
    for (const part of extra.split(',')) {
      const trimmed = part.trim()
      if (trimmed) allowed.add(trimmed.replace(/\/$/, ''))
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000')
    allowed.add('http://127.0.0.1:3000')
  }
  return allowed
}

/**
 * CSRF defense for cookie-setting auth routes.
 *
 * IMPORTANT: Do not compare Origin to `new URL(req.url).origin` on Firebase App Hosting.
 * Behind the edge proxy, `req.url` is an internal origin, while the browser Origin is the
 * public host (writtenboard.com / *.hosted.app). That mismatch returned HTTP 403 for all
 * legitimate browser session creates.
 */
export function assertSameOrigin(req: Request) {
  const originHeader = req.headers.get('origin')
  if (!originHeader) {
    logAuthReject('assertSameOrigin', 'missing_origin')
    throw authError('Missing origin', 403, 'missing_origin')
  }

  let origin: URL
  try {
    origin = new URL(originHeader)
  } catch {
    logAuthReject('assertSameOrigin', 'invalid_origin_format')
    throw authError('Invalid origin', 403, 'invalid_origin_format')
  }

  const normalized = origin.origin
  const allowed = getAllowedOrigins()
  if (!allowed.has(normalized)) {
    logAuthReject('assertSameOrigin', 'origin_not_allowed', {
      originHost: origin.host,
      reqHost: (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim() || '(none)',
      urlHost: safeUrlHost(req.url),
    })
    throw authError('Invalid origin', 403, 'origin_not_allowed')
  }

  if (origin.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    logAuthReject('assertSameOrigin', 'origin_insecure', { originHost: origin.host })
    throw authError('Invalid origin', 403, 'origin_insecure')
  }
}

function safeUrlHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable)'
  }
}

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
