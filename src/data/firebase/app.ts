// Firebase の初期化。認証（Issue #5・#6）と Firestore 版リポジトリ（#7 以降）はここから auth / db を使う。
// 設定値は .env.local から読む（.env.example を参照）。VITE_USE_EMULATOR=true ならローカルのエミュレータに接続する。

import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

export const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true'

/** エミュレータ用のプロジェクト ID。"demo-" で始まる ID は本番の Firebase に一切つながらない */
const EMULATOR_PROJECT_ID = 'demo-bukatsu'

const env = import.meta.env

const config: FirebaseOptions = useEmulator
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID || 'demo-app-id',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }

if (!useEmulator && !config.apiKey) {
  throw new Error('Firebase の設定がありません。.env.example をコピーして .env.local を作成してください')
}

export const app = initializeApp(config)
export const auth = getAuth(app)
export const db = getFirestore(app)

if (useEmulator) {
  // スマホ実機（同じ Wi-Fi）から PC のエミュレータにつなぐときのため、開いているホスト名を使う。
  // localhost は IPv6 に解決されることがあるので 127.0.0.1 にそろえる
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
}
