import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('Firebase security regression checks', () => {
  it('moderation route verifies bearer/session auth and role claim', () => {
    const s = read('app/api/moderation/review/route.ts')
    expect(s).toContain('requireUser')
    expect(s).toContain('isModerator')
    expect(s).not.toContain('x-user-id')
  })

  it('emergency route verifies auth and role claim', () => {
    const s = read('app/api/broadcast/emergency/route.ts')
    expect(s).toContain('requireUser')
    expect(s).toContain('isModerator')
    expect(s).not.toContain('x-user-id')
  })

  it('Firestore rules deny direct writes to protected collections including broadcast_queue', () => {
    const s = read('firestore.rules')
    expect(s).toContain('match /submissions/{id}')
    expect(s).toContain('match /broadcast_queue/{id}')
    expect(s).toMatch(/match \/broadcast_queue\/\{id\}[\s\S]*allow write: if false/)
    expect(s).toContain('match /rate_limits/{uid}')
  })

  it('Storage rules deny all client reads and writes', () => {
    const s = read('storage.rules')
    expect(s).toContain('allow read, write: if false')
    expect(s).not.toContain('request.auth.uid == uid')
  })

  it('uploads are prepared by the server before a signed write URL is issued', () => {
    expect(existsSync(resolve(process.cwd(), 'app/api/uploads/prepare/route.ts'))).toBe(true)
    const s = read('app/api/uploads/prepare/route.ts')
    expect(s).toContain('getSignedUrl')
    expect(s).toContain('displayName')
    expect(s).toContain('count >= 3')
  })

  it('submission route reserves the rate limit before calling moderation', () => {
    const s = read('app/api/submissions/route.ts')
    const rateIdx = s.indexOf('count >= 3')
    const modIdx = s.indexOf('await moderateText')
    expect(rateIdx).toBeGreaterThan(-1)
    expect(modIdx).toBeGreaterThan(rateIdx)
    expect(s).toContain("status: 'pending_moderation'")
  })

  it('moderation provider fails closed on non-success HTTP responses', () => {
    const s = read('lib/moderation/provider.ts')
    expect(s).toContain('if (!res.ok)')
    expect(s).toContain('pass: false')
  })

  it('session logout revokes refresh tokens', () => {
    const s = read('app/api/auth/session/route.ts')
    expect(s).toContain('revokeRefreshTokens')
    expect(s).toContain('assertSameOrigin')
  })

  it('contains no Supabase SDK references in application source', () => {
    const files = [
      'package.json',
      'app/page.tsx',
      'app/admin/page.tsx',
      'app/profile/page.tsx',
      'app/submit/page.tsx',
      'workers/broadcast-worker.ts',
    ]
    for (const f of files) expect(read(f).toLowerCase()).not.toContain('supabase')
    expect(existsSync(resolve(process.cwd(), 'lib/supabase'))).toBe(false)
  })

  it('broadcast worker uses Firebase and never defaults to claiming RTMP success', () => {
    const s = read('workers/broadcast-worker.ts')
    expect(s).toContain("BROADCAST_MODE || 'dry-run'")
    expect(s).toContain('played_dry_run')
    expect(s).toContain("MODE === 'rtmp' ? 'broadcast'")
  })
})
