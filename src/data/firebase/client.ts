import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

export function createFirebaseClient() {
  const env = import.meta.env
  const emulate = env.VITE_USE_FIREBASE_EMULATORS === 'true'
  const projectId = env.VITE_FIREBASE_PROJECT_ID || (emulate ? 'demo-bukatsu' : '')
  if (
    !projectId ||
    (!emulate && (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_APP_ID || !env.VITE_FIREBASE_AUTH_DOMAIN))
  ) {
    throw new Error('Firebase設定が不足しています。.env.local の設定を確認してください。')
  }
  const app = initializeApp({
    projectId,
    apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
    appId: env.VITE_FIREBASE_APP_ID || 'demo-app-id',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  })
  const auth = getAuth(app)
  const db = initializeFirestore(app, {
    localCache: emulate ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  if (emulate) {
    connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(
      db,
      env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
      Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
    )
  }
  return { auth, db }
}
