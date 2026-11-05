import { resolve } from 'node:path'
import { loadEnvConfig } from '@next/env'

/** Production Firebase project for WrittenBoard admin bootstrap. */
export const EXPECTED_PROJECT_ID = 'writtenboard'

/**
 * Load Next-style local env files (including `.env.local`) into `process.env`.
 * Must run before importing `lib/firebase/admin`.
 */
export function loadLocalEnv(cwd: string = process.cwd()) {
  loadEnvConfig(resolve(cwd))
}

type EnvMap = Record<string, string | undefined>

export function getEffectiveProjectId(env: EnvMap = process.env): string | undefined {
  const id = (env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim()
  return id || undefined
}

/** Abort unless the effective Admin project is WrittenBoard. */
export function assertWrittenboardProject(env: EnvMap = process.env): string {
  const projectId = getEffectiveProjectId(env)
  if (!projectId) {
    throw new Error(
      'Firebase project ID is missing after loading local env. Set FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local.',
    )
  }
  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Refusing to bootstrap: effective Firebase project is "${projectId}", expected "${EXPECTED_PROJECT_ID}".`,
    )
  }
  return projectId
}

export function requireBootstrapAdminUid(env: EnvMap = process.env): string {
  const uid = env.FIREBASE_BOOTSTRAP_ADMIN_UID?.trim()
  if (!uid) {
    throw new Error(
      'Set FIREBASE_BOOTSTRAP_ADMIN_UID to the verified Firebase Auth UID of the first administrator.',
    )
  }
  return uid
}
