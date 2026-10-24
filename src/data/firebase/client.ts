import { firebaseOptions, usesEmulators } from './config'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

export const isUsingEmulators = () => usesEmulators(import.meta.env)
let cached: { auth: Auth; db: Firestore } | undefined

export function createFirebaseClient() {
  if (cached) return cached
  const env = import.meta.env
  const { emulate, options } = firebaseOptions(env)
  const app = getApps().length ? getApp() : initializeApp(options)
  const auth = getAuth(app)
  const db = initializeFirestore(app, {
    localCache: emulate ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  if (emulate) {
    const host = typeof location === 'undefined' || location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
    connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR_URL || `http://${host}:9099`, { disableWarnings: true })
    connectFirestoreEmulator(
      db,
      env.VITE_FIRESTORE_EMULATOR_HOST || host,
      Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
    )
  }
  cached = { auth, db }
  return cached
}
