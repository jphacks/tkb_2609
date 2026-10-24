import type { FirebaseOptions } from 'firebase/app'
type Env = Readonly<Record<string, string | undefined>>

/** 旧・新設定が混在しても、どちらかがtrueなら必ずエミュレータへ向ける。 */
export const usesEmulators = (env: Env) =>
  env.VITE_USE_EMULATOR === 'true' || env.VITE_USE_FIREBASE_EMULATORS === 'true'
export function firebaseOptions(env: Env): { emulate: boolean; options: FirebaseOptions } {
  const emulate = usesEmulators(env)
  if (emulate)
    return {
      emulate,
      options: {
        projectId: 'demo-bukatsu',
        apiKey: 'demo-api-key',
        appId: 'demo-app-id',
        authDomain: 'demo-bukatsu.firebaseapp.com',
      },
    }
  if (
    !env.VITE_FIREBASE_PROJECT_ID ||
    !env.VITE_FIREBASE_API_KEY ||
    !env.VITE_FIREBASE_APP_ID ||
    !env.VITE_FIREBASE_AUTH_DOMAIN
  )
    throw new Error('Firebase設定が不足しています。.env.local の設定を確認してください。')
  return {
    emulate,
    options: {
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      apiKey: env.VITE_FIREBASE_API_KEY,
      appId: env.VITE_FIREBASE_APP_ID,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    },
  }
}
