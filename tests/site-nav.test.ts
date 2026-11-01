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

  it('shows Sign In on mobile when signed out and hamburger only when signed in', () => {
    const nav = read('components/nav/SiteNav.tsx')
    const css = read('components/nav/site-nav.css')
    expect(nav).toContain('sn-mobile-signin')
    expect(nav).toContain('{!signedIn && (')
    expect(nav).toContain('{signedIn && (')
    expect(nav).toContain('className="sn-menu-btn"')
    expect(css).toContain('.sn-mobile-signin')
    expect(css).toContain('.sn-desktop { display: none !important; }')
  })

  it('signed-in mobile menu lists Home, Submit, Profile, and Sign Out', () => {
    const nav = read('components/nav/SiteNav.tsx')
    const panelStart = nav.indexOf('aria-label="Site menu"')
    expect(panelStart).toBeGreaterThan(-1)
    const panel = nav.slice(panelStart, nav.indexOf('</div>', panelStart) + 6)
    expect(panel).toContain('href="/"')
    expect(panel).toContain('Submit Content')
    expect(panel).toContain('href="/profile"')
    expect(panel).toContain('Sign Out')
    expect(panel).not.toContain('Sign In')
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
