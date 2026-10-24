import { useState, type FormEvent } from 'react'
import { useRepository } from '../../app/contexts'
import { CheckIcon } from '../../components/icons'
import { RepositoryError } from '../../data/repository'
import { PASSWORD_RULES, isStrongPassword } from '../../lib/password'
import styles from './auth.module.css'

export function SignUpScreen({ onLogin }: { onLogin(): void }) {
  const repo = useRepository()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = displayName.trim() !== '' && email !== '' && isStrongPassword(password)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await repo.auth.signUp({ email, password, displayName })
    } catch (err) {
      setError(err instanceof RepositoryError ? err.message : '登録に失敗しました')
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.heading}>
        <h1 className={styles.title}>アカウントを作成</h1>
        <p className="muted">作成後、チームの参加コードを入力します</p>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className="field">
          <span className="label">名前（チーム内で表示されます）</span>
          <input
            className="input"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="山田 太郎"
          />
        </label>
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
        <label className="field">
          <span className="label">パスワード</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <ul className={styles.rules} aria-label="パスワードの条件">
          {PASSWORD_RULES.map((rule) => {
            const ok = rule.test(password)
            return (
              <li key={rule.label} className={ok ? styles.ruleOk : undefined}>
                <CheckIcon size={16} />
                {rule.label}
              </li>
            )
          })}
        </ul>

        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={!canSubmit || busy}>
          {busy ? '作成中…' : '作成する'}
        </button>
      </form>

      <div className={styles.switch}>
        <span className="muted">アカウントをお持ちの方は</span>
        <button className="btn btn-secondary btn-block" onClick={onLogin}>
          ログイン
        </button>
      </div>
    </div>
  )
}
