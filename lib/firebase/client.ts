'use client'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let cached: { app: FirebaseApp; auth: Auth } | null = null

export function firebaseClient() {
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.storageBucket || !config.appId) {
    throw new Error('Firebase client configuration is incomplete.')
  }
  if (cached) return cached
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        appId: config.appId,
      })
  cached = { app, auth: getAuth(app) }
  return cached
}
