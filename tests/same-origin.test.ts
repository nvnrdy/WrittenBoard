import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSameOrigin, getAllowedOrigins } from '@/lib/firebase/server-auth'

function req(origin: string | null, url = 'http://127.0.0.1:8080/api/auth/session', host?: string) {
  const headers = new Headers()
  if (origin) headers.set('origin', origin)
  if (host) headers.set('host', host)
  return new Request(url, { method: 'POST', headers })
}

describe('assertSameOrigin (App Hosting CSRF)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects missing Origin with 403', () => {
    try {
      assertSameOrigin(req(null))
      expect.fail('expected throw')
    } catch (e: unknown) {
      const err = e as { status?: number; reason?: string }
      expect(err.status).toBe(403)
      expect(err.reason).toBe('missing_origin')
    }
  })

  it('rejects Origin that is not on the allowlist even when it matches req.url', () => {
    try {
      assertSameOrigin(req('https://evil.example', 'https://evil.example/api/auth/session'))
      expect.fail('expected throw')
    } catch (e: unknown) {
      const err = e as { status?: number; reason?: string }
      expect(err.status).toBe(403)
      expect(err.reason).toBe('origin_not_allowed')
    }
  })

  it('allows writtenboard.com even when req.url is an internal App Hosting/Cloud Run origin', () => {
    expect(() =>
      assertSameOrigin(
        req(
          'https://writtenboard.com',
          'http://127.0.0.1:8080/api/auth/session',
          'writtenboard.com',
        ),
      ),
    ).not.toThrow()
  })

  it('allows the App Hosting default URL when browser Origin matches that host', () => {
    expect(() =>
      assertSameOrigin(
        req(
          'https://writtenboard--writtenboard.asia-southeast1.hosted.app',
          'http://localhost/api/auth/session',
        ),
      ),
    ).not.toThrow()
  })

  it('includes localhost origins outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const allowed = getAllowedOrigins()
    expect(allowed.has('http://localhost:3000')).toBe(true)
    expect(() => assertSameOrigin(req('http://localhost:3000', 'http://localhost:3000/api/auth/session'))).not.toThrow()
  })

  it('accepts extra origins from ALLOWED_ORIGINS', () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://staging.example.com')
    expect(() => assertSameOrigin(req('https://staging.example.com', 'http://127.0.0.1/api/auth/session'))).not.toThrow()
  })
})

describe('session route origin regression (source)', () => {
  it('documents that session create uses assertSameOrigin before verifyIdToken', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const s = readFileSync(resolve(process.cwd(), 'app/api/auth/session/route.ts'), 'utf8')
    const originIdx = s.indexOf('assertSameOrigin(req)')
    const verifyIdx = s.indexOf('verifyIdToken')
    expect(originIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeGreaterThan(originIdx)
    expect(s).toContain('logAuthReject')
    expect(s).toContain('reason')
  })
})
