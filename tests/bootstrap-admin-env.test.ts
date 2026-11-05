import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EXPECTED_PROJECT_ID,
  assertWrittenboardProject,
  getEffectiveProjectId,
  requireBootstrapAdminUid,
} from '../scripts/bootstrap-admin-env'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('bootstrap-admin env helpers', () => {
  it('resolves project id from FIREBASE_PROJECT_ID or NEXT_PUBLIC fallback', () => {
    expect(getEffectiveProjectId({ FIREBASE_PROJECT_ID: 'writtenboard' })).toBe('writtenboard')
    expect(getEffectiveProjectId({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writtenboard' })).toBe('writtenboard')
    expect(getEffectiveProjectId({
      FIREBASE_PROJECT_ID: 'writtenboard',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'other',
    })).toBe('writtenboard')
    expect(getEffectiveProjectId({})).toBeUndefined()
  })

  it('requires effective project id writtenboard', () => {
    expect(assertWrittenboardProject({ FIREBASE_PROJECT_ID: 'writtenboard' })).toBe(EXPECTED_PROJECT_ID)
    expect(() => assertWrittenboardProject({})).toThrow(/project ID is missing/i)
    expect(() => assertWrittenboardProject({ FIREBASE_PROJECT_ID: 'gen-lang-client-0939485284' })).toThrow(
      /expected "writtenboard"/i,
    )
  })

  it('requires a non-empty bootstrap admin uid', () => {
    expect(requireBootstrapAdminUid({ FIREBASE_BOOTSTRAP_ADMIN_UID: 'abc123' })).toBe('abc123')
    expect(() => requireBootstrapAdminUid({})).toThrow(/FIREBASE_BOOTSTRAP_ADMIN_UID/)
    expect(() => requireBootstrapAdminUid({ FIREBASE_BOOTSTRAP_ADMIN_UID: '   ' })).toThrow(
      /FIREBASE_BOOTSTRAP_ADMIN_UID/,
    )
  })

  it('loads local env before dynamically importing firebase admin', () => {
    const s = read('scripts/bootstrap-admin.ts')
    expect(s).toContain('loadLocalEnv()')
    expect(s).toContain('assertWrittenboardProject()')
    expect(s).toContain('requireBootstrapAdminUid()')
    expect(s).toContain("await import('../lib/firebase/admin')")
    expect(s.indexOf('loadLocalEnv()')).toBeLessThan(s.indexOf("await import('../lib/firebase/admin')"))
    expect(s).not.toMatch(/console\.(log|error|info).*PRIVATE_KEY/)
    expect(s).not.toContain('FIREBASE_PRIVATE_KEY')
  })

  it('bootstrap-admin-env uses Next loadEnvConfig for .env.local', () => {
    const s = read('scripts/bootstrap-admin-env.ts')
    expect(s).toContain("from '@next/env'")
    expect(s).toContain('loadEnvConfig')
    expect(s).toContain("EXPECTED_PROJECT_ID = 'writtenboard'")
  })
})
