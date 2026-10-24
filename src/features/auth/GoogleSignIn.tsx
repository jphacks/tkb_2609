import { useState } from 'react'
import { useRepository } from '../../app/contexts'
import { RepositoryError } from '../../data/repository'
import { detectInAppBrowser, externalBrowserUrl } from '../../lib/inAppBrowser'
import styles from './auth.module.css'

/** Google アカウントでのログイン（初回は登録も兼ねる）。アプリ内ブラウザでは、外部ブラウザで開くよう案内する（#31） */
export function GoogleSignIn({ label }: { label: string }) {
  const repo = useRepository()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inApp = detectInAppBrowser(navigator.userAgent)

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      // ポップアップがブロックされないよう、クリックの直後に呼ぶ（間に await を挟まない）
      await repo.auth.signInWithGoogle()
    } catch (err) {
      setError(err instanceof RepositoryError ? err.message : 'Google でのログインに失敗しました')
    }
    // 成功するとログイン後の画面に切り替わる。閉じた・失敗した場合はもう一度押せるようにする
    setBusy(false)
  }

  return (
    <div className={styles.google}>
      <div className={styles.divider}>または</div>
      {inApp ? (
        <div className={styles.notice} role="note">
          <p>
            {inApp === 'line' ? 'LINE' : 'アプリ'}内のブラウザでは、Google でログインできません。
            {inApp === 'line'
              ? '下のボタンから Safari などのブラウザで開いてください。'
              : 'メニューから「ブラウザで開く」を選んでください。'}
            メールアドレスとパスワードでのログインは、このまま使えます。
          </p>
          {inApp === 'line' && (
            <a className="btn btn-secondary btn-block" href={externalBrowserUrl(location.href)}>
              ブラウザで開く
            </a>
          )}
        </div>
      ) : (
        <>
          {error && <p className="error-text">{error}</p>}
          <button type="button" className="btn btn-secondary btn-block" onClick={signIn} disabled={busy}>
            <GoogleLogo />
            {busy ? 'Google と通信中…' : label}
          </button>
        </>
      )}
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
