import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function getAdminApp(): App {
  if (getApps().length) return getApps()[0]!
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  const credential = clientEmail && privateKey && projectId
    ? cert({ projectId, clientEmail, privateKey })
    : applicationDefault()
  return initializeApp({
    credential,
    ...(projectId ? { projectId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  })
}

export const adminAuth = getAuth(getAdminApp())
export const db = getFirestore(getAdminApp())

export function getBucket() {
  const name = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  if (!name) throw new Error('Firebase Storage bucket is not configured')
  return getStorage(getAdminApp()).bucket(name)
}
