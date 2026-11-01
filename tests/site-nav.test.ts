import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('shared site navigation', () => {
  it('uses one SiteNav for app shell and landing', () => {
    const header = read('components/app-shell/AppHeader.tsx')
    const landing = read('components/landing/LandingPage.tsx')
    const nav = read('components/nav/SiteNav.tsx')
    expect(header).toContain('SiteNav')
    expect(landing).toContain('<SiteNav')
    expect(nav).toContain('aria-expanded')
    expect(nav).toContain('aria-controls')
    expect(nav).toContain('Open menu')
    expect(nav).toContain('Home')
    expect(nav).toContain('Submit Content')
    expect(nav).toContain('Profile')
  })

  it('closes the menu on navigation and Escape', () => {
    const nav = read('components/nav/SiteNav.tsx')
    expect(nav).toContain("e.key === 'Escape'")
    expect(nav).toContain('onClick={closeMenu}')
  })

  it('does not redefine auth session creation', () => {
    const nav = read('components/nav/SiteNav.tsx')
    expect(nav).not.toContain('verifyIdToken')
    expect(nav).not.toContain('createSessionCookie')
    expect(nav).toContain("method: 'DELETE'")
  })
})
