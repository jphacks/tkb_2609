// 実ブラウザのIndexedDB・タブ間同期を検証する手動回帰テスト（#64）。
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { createFirestoreRepository } from '../../src/data/firebase/firestoreRepository'

if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('localhost専用のテストです')
const app = initializeApp({ projectId: 'demo-bukatsu', apiKey: 'fake-api-key', appId: 'fake-app-id' }, 'issue64-browser')
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const token = [
  { alg: 'none', typ: 'JWT' },
  { sub: 'issue64-browser-google', email: 'issue64-google@example.invalid', email_verified: true, name: 'Google Test' },
].map((part) => btoa(JSON.stringify(part)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')).join('.') + '.'
const repo = createFirestoreRepository(auth, db, {
  googleSignIn: (a) => signInWithCredential(a, GoogleAuthProvider.credential(token)),
})
const state = document.querySelector<HTMLParagraphElement>('#state')!
const error = document.querySelector<HTMLParagraphElement>('#error')!
const history = document.querySelector<HTMLOListElement>('#history')!
repo.auth.onAuthStateChanged((user) => {
  state.textContent = user ? `ログイン中：${user.email} (${user.uid})` : 'ログアウト中'
  const item = document.createElement('li')
  item.textContent = state.textContent
  history.append(item)
})
const operations: Record<string, () => Promise<void>> = {
  signup: () => repo.auth.signUp({ email: 'issue64-browser@example.invalid', password: 'Example123!', displayName: 'Tab Test' }),
  email: () => repo.auth.signIn('issue64-browser@example.invalid', 'Example123!'),
  google: () => repo.auth.signInWithGoogle(),
  logout: () => repo.auth.signOut(),
}
for (const [id, operation] of Object.entries(operations)) {
  const button = document.getElementById(id) as HTMLButtonElement
  button.addEventListener('click', async () => {
    button.disabled = true
    error.textContent = ''
    try {
      await operation()
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : 'テスト失敗'
    } finally {
      button.disabled = false
    }
  })
}
