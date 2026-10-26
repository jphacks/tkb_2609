import { useState, type FormEvent } from 'react'
import { useAccountNavigation, useRepository } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { RepositoryError } from '../../data/repository'
import { JOIN_CODE_LENGTH, normalizeJoinCode } from '../../lib/joinCode'
import type { UserProfile } from '../../types'
import styles from './auth.module.css'

/** チームに未所属のユーザー向け。参加コードで参加するか、チームを作る */
export function TeamEntryScreen({ profile, onDone }: { profile: UserProfile; onDone?: () => void }) {
  const repo = useRepository()
  const openAccount = useAccountNavigation()
  const { run } = useFeedback()
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'join') await repo.teams.join(code, displayName)
      else await repo.teams.create(teamName, displayName)
      onDone?.()
    } catch (err) {
      setError(err instanceof RepositoryError ? err.message : '通信に失敗しました')
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{profile.displayName} さん、ようこそ</h1>
        <p className="muted">チームに参加しましょう</p>
      </div>

      <div className={styles.segment} role="tablist">
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          参加コードで参加
        </button>
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          チームを作る
        </button>
      </div>

      <form className={styles.form} onSubmit={submit}>
        <label className="field">
          <span className="label">このチームでの名前</span>
          <input className="input" required maxLength={50} value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} placeholder="チーム内で使う名前" />
          <span className="hint">チームごとに別の名前を使えます。参加後も設定から変更できます。</span>
        </label>
        {mode === 'join' ? (
          <label className="field">
            <span className="label">参加コード</span>
            <input
              className={`input ${styles.codeInput}`}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={JOIN_CODE_LENGTH + 4}
              required
              value={code}
              onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
              placeholder="K7MPX2QA"
            />
            <span className="hint">管理者から LINE などで共有されたコードを入力してください</span>
          </label>
        ) : (
          <label className="field">
            <span className="label">チーム名</span>
            <input
              className="input"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="〇〇高校 〇〇部"
            />
            <span className="hint">作成したあなたがチームの管理者になります</span>
          </label>
        )}

        <p className="hint">出欠は1予定につき「出席以外」の回答が500件までです。出席の回答はこの上限に含まれません。</p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {mode === 'join' ? '参加する' : 'チームを作る'}
        </button>
      </form>

      <div className={styles.switch}>
        {openAccount && <button className="btn btn-secondary btn-block" onClick={openAccount}>アカウント設定</button>}
        {onDone && <button className="btn btn-secondary btn-block" disabled={busy} onClick={onDone}>戻る</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => run(() => repo.auth.signOut())}>
          ログアウト
        </button>
      </div>
    </div>
  )
}
