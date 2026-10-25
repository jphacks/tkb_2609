// Firebase の初期化。認証（Issue #5・#6）と Firestore 版リポジトリ（#7 以降）はここから auth / db を使う。
// 設定値は .env.local から読む（.env.example を参照）。VITE_USE_EMULATOR=true ならローカルのエミュレータに接続する。

import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// PR #19 の初期版で使っていた旧名。残ったままだとエミュレータのつもりで本番につながるおそれがあるため、
// 起動を止めて書き換えを促す（エラーは src/data/index.ts が画面に表示する）
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== undefined) {
  throw new Error('.env.local の VITE_USE_FIREBASE_EMULATORS は使われなくなりました。VITE_USE_EMULATOR に名前を変えてください')
}

export const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true'

/** エミュレータ用のプロジェクト ID。"demo-" で始まる ID は本番の Firebase に一切つながらない */
const EMULATOR_PROJECT_ID = 'demo-bukatsu'

const env = import.meta.env

// Firebase Hosting（*.web.app / *.firebaseapp.com）で配信しているときは、開いているサイトのドメインでログイン処理を行う。
// Google のログイン画面に、利用者が開いているのと同じアドレス（bukatsu20261024.web.app）が表示され、
// iPhone の Safari でもログイン処理が同じサイトの中で完結する。localhost などで本番に接続するときは .env.local の値を使う。
// 新しいドメインで配信する場合は、Google Cloud の OAuth クライアントに https://<ドメイン>/__/auth/handler を追加する
const hostingAuthDomain = /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) ? location.hostname : undefined

const config: FirebaseOptions = useEmulator
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID || 'demo-app-id',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: hostingAuthDomain || env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }

if (!useEmulator && !config.apiKey) {
  throw new Error('Firebase の設定がありません。.env.example をコピーして .env.local を作成してください')
}

export const app = initializeApp(config)
// 保存先は全ログイン経路で getAuth の既定に統一する（#64）。
// メールログインだけ localStorage に変えると、新しいタブの IndexedDB 移行で既存タブがログアウトする。
export const auth = getAuth(app)
// 本番では端末内（IndexedDB）にキャッシュし、起動直後や再接続時の表示と読み取り回数を抑える（Issue #11）。
// 複数タブで開いても同じキャッシュを共有する。エミュレータでは毎回まっさらな状態で試せるようメモリのみ
export const db = initializeFirestore(app, {
  localCache: useEmulator ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (useEmulator) {
  // スマホ実機（同じ Wi-Fi）から PC のエミュレータにつなぐときのため、開いているホスト名を使う。
  // localhost は IPv6 に解決されることがあるので 127.0.0.1 にそろえる
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
}
