import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('UI polish honesty and shared patterns', () => {
  it('homepage avoids promising unsupported features or fake featured submissions', () => {
    const landing = read('components/landing/LandingPage.tsx')
    expect(landing).not.toContain('live preview')
    expect(landing).not.toContain('Get notified')
    expect(landing).not.toContain('Recently on WrittenBoard')
    expect(landing).toContain('What you can share')
    expect(landing).toContain('not a feed of recent submissions')
    expect(landing).toContain('not confirmed broadcast times')
    expect(landing).toContain('Broadcast is offline')
    expect(landing).toContain('wb-badge-live')
  })

  it('profile keeps email private and highlights public username', () => {
    const profile = read('app/profile/client.tsx')
    expect(profile).toContain('Public username')
    expect(profile).toContain('never used as your public identity')
    expect(profile).toContain('wa-account')
    expect(profile).toContain('wa-empty')
    expect(profile).toContain('submissionStatusLabel')
  })

  it('submit page shows type selection, limits, preview and success state', () => {
    const submit = read('app/submit/client.tsx')
    expect(submit).toContain('wa-type-tab')
    expect(submit).toContain('aria-pressed')
    expect(submit).toContain('500 characters')
    expect(submit).toContain('createObjectURL')
    expect(submit).toContain('Submitted for review')
    expect(submit).toContain('if (busy) return')
    expect(submit).toContain('/api/submissions')
  })

  it('shared shells keep focus styles and overflow guards', () => {
    const shell = read('components/app-shell/app-shell.css')
    const landing = read('components/landing/landing.css')
    const nav = read('components/nav/site-nav.css')
    expect(shell).toContain(':focus-visible')
    expect(shell).toContain('overflow-x: hidden')
    expect(landing).toContain(':focus-visible')
    expect(landing).toContain('overflow-x: hidden')
    expect(nav).toContain(':focus-visible')
  })
})
