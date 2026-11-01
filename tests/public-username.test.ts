import { describe, expect, it } from 'vitest'
import { generatePublicUsername, isGeneratedUsernameFormat } from '@/lib/auth/public-username'
import { nicknameSchema } from '@/lib/validation'
import { submissionStatusLabel, submissionStatusTone } from '@/lib/submissions/status-label'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('public username generation', () => {
  it('produces adjective+noun+digits names that pass nickname validation', () => {
    let i = 0
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    const random = () => seq[i++ % seq.length]!
    const name = generatePublicUsername(random)
    expect(nicknameSchema.safeParse(name).success).toBe(true)
    expect(isGeneratedUsernameFormat(name)).toBe(true)
    expect(name).not.toMatch(/@/)
  })

  it('never uses email-like strings', () => {
    for (let n = 0; n < 20; n++) {
      const name = generatePublicUsername(() => (n + 1) / 21)
      expect(name.includes('@')).toBe(false)
      expect(name.toLowerCase().includes('gmail')).toBe(false)
    }
  })
})

describe('profile auto-username wiring', () => {
  it('auth profile route assigns usernames via claim helper and does not copy Google names', () => {
    const s = read('app/api/auth/profile/route.ts')
    expect(s).toContain('ensureProfileWithPublicUsername')
    expect(s).not.toContain('user.displayName')
    expect(s).not.toContain('user.name')
  })

  it('claim helper preserves existing non-empty displayName', () => {
    const s = read('lib/auth/claim-username.ts')
    expect(s).toContain('if (current)')
    expect(s).toContain('assigned: false')
    expect(s).toContain('nicknames')
    expect(s).toContain('generatePublicUsername')
  })

  it('nickname change route still validates and enforces uniqueness', () => {
    const s = read('app/api/profile/nickname/route.ts')
    expect(s).toContain('nicknameSchema')
    expect(s).toContain('Nickname is already taken')
    expect(s).toContain('nicknames')
  })
})

describe('auth navigation consistency', () => {
  it('homepage passes signed-in state into landing nav', () => {
    const page = read('app/page.tsx')
    const landing = read('components/landing/LandingPage.tsx')
    const nav = read('components/nav/SiteNav.tsx')
    expect(page).toContain('currentUser')
    expect(page).toContain('signedIn={!!user}')
    expect(landing).toContain('SiteNav')
    expect(landing).toContain('signedIn={signedIn}')
    expect(nav).toContain('href="/profile"')
    expect(nav).toContain('Submit Content')
    expect(nav).toContain('href="/"')
  })

  it('shared nav shows Sign In or Profile based on signedIn', () => {
    const nav = read('components/nav/SiteNav.tsx')
    expect(nav).toContain('Sign In')
    expect(nav).toContain('href="/profile"')
    expect(nav).toContain('Sign Out')
    expect(nav).toContain('signedIn ?')
  })

  it('homepage helper text is conditional on signedIn', () => {
    const landing = read('components/landing/LandingPage.tsx')
    expect(landing).toContain("You're signed in. Your content is ready to submit.")
    expect(landing).toContain('Sign in to submit your content.')
    expect(landing).toContain('signedIn')
  })

  it('homepage Submit CTA sends signed-out visitors to /auth', () => {
    const landing = read('components/landing/LandingPage.tsx')
    expect(landing).toContain("href={signedIn ? '/submit' : '/auth'}")
  })
})

describe('submission status labels', () => {
  it('maps implemented backend statuses only', () => {
    expect(submissionStatusLabel('pending_moderation')).toBe('Under review')
    expect(submissionStatusLabel('approved')).toBe('Approved')
    expect(submissionStatusLabel('rejected')).toBe('Rejected')
    expect(submissionStatusLabel('revoked')).toBe('Removed')
    expect(submissionStatusLabel('broadcast')).toBe('Aired')
    expect(submissionStatusTone('pending_moderation')).toBe('pending')
    expect(submissionStatusTone('rejected')).toBe('danger')
  })
})
