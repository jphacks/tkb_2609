import { AppLogo } from '../../components/AppLogo'
import { useState, type FormEvent } from 'react'
import { useRepository } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { BackIcon } from '../../components/icons'
import { isMock } from '../../data'
import { MOCK_ACCOUNTS, MOCK_PASSWORD } from '../../data/mock/seed'
import { RepositoryError } from '../../data/repository'
import { PasswordInput } from '../../components/PasswordInput'
import styles from './auth.module.css'
import { GoogleSignIn } from './GoogleSignIn'

export function LoginScreen({ onSignUp, onBack }: { onSignUp(): void; onBack?(): void }) {
  const repo = useRepository()
  const { run, confirm } = useFeedback()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await repo.auth.signIn(email, password)
    } catch (err) {
      setError(err instanceof RepositoryError ? err.message : 'ログインに失敗しました')
      setBusy(false)
    }
  }

  const resetPassword = async () => {
    if (!email) {
      setError('パスワード再設定メールの送信先として、メールアドレスを入力してください')
      return
    }
    const ok = await confirm({ title: 'パスワード再設定', message: `${email} に再設定用のメールを送ります。`, confirmLabel: '送信' })
    if (ok) await run(() => repo.auth.sendPasswordReset(email), '再設定メールを送信しました')
  }

  return (
    <div className={styles.screen}>
      {onBack && (
        <button type="button" className={`btn btn-ghost btn-sm ${styles.backLink}`} onClick={onBack}>
          <BackIcon size={18} />
          トップへ戻る
        </button>
      )}
      <div className={styles.brand}>
        <AppLogo size={52} />
        <h1 className={styles.appName}>BUKATSU</h1>
        <p className={styles.tagline}>予定と用具を、チームでかんたんに共有</p>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className="field">
          <span className="label">メールアドレス</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <PasswordInput label="パスワード" autoComplete="current-password" value={password} onChange={setPassword} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetPassword}>
          パスワードを忘れた場合
        </button>
      </form>

      <GoogleSignIn label="Google でログイン" />

      <div className={styles.switch}>
        <span className="muted">はじめての方は</span>
        <button className="btn btn-secondary btn-block" onClick={onSignUp}>
          アカウントを作成
        </button>
      </div>

      {isMock && (
        <div className={styles.mockBox}>
          <p className={styles.mockTitle}>モック用アカウント（タップで入力）</p>
          {MOCK_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              className={styles.mockAccount}
              onClick={() => {
                setEmail(account.email)
                setPassword(MOCK_PASSWORD)
              }}
            >
              <span>{account.label}</span>
              <span className="muted">{account.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
