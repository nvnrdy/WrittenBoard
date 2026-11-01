'use client'

/**
 * Optional App Check bootstrap. Enable App Check in Firebase Console, then set
 * NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY (reCAPTCHA v3 site key).
 * Without the key this is a no-op so local/dev keeps working.
 */
let started = false

export async function initAppCheck() {
  if (started || typeof window === 'undefined') return
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY
  if (!siteKey) return
  started = true
  const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
  const { firebaseClient } = await import('./client')
  initializeAppCheck(firebaseClient().app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
}
