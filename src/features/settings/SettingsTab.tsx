import { useState, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { isMock, resetMockData } from '../../data'
import { AdminSettings } from './AdminSettings'
import { MemberList } from './MemberList'
import styles from './settings.module.css'

export function SettingsTab() {
  const repo = useRepository()
  const { team, user, me, members, isAdmin } = useSession()
  const { run, confirm } = useFeedback()
  const isLastAdmin = isAdmin && members.filter((m) => m.role === 'admin').length <= 1

  const signOut = async () => {
    const ok = await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' })
    if (ok) await run(() => repo.auth.signOut())
  }

  const leave = async () => {
    const ok = await confirm({
      title: `「${team.name}」を離れますか？`,
      message: '持っている用具は手放した状態になります。もう一度参加するには参加コードが必要です。',
      confirmLabel: '離れる',
      danger: true,
    })
    if (ok) await run(() => repo.teams.leave(team.id), 'チームを離れました')
  }

  const resetMock = async () => {
    const ok = await confirm({
      title: 'モックデータを初期状態に戻しますか？',
      message: '追加・変更した内容はすべて消え、ログアウトします。',
      confirmLabel: '初期化',
      danger: true,
    })
    if (ok) resetMockData()
  }

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className="section-title">あなた</h2>
        <div className={`card ${styles.group}`}>
          <NameForm
            id="display-name"
            label="名前"
            initial={me.displayName}
            onSave={(name) => run(() => repo.users.updateDisplayName(name), '名前を変更しました')}
          />
          <div className={styles.item}>
            <span className={styles.itemLabel}>メールアドレス</span>
            <span className={styles.itemValue}>{user.email}</span>
          </div>
          <div className={styles.item}>
            <span className={styles.itemLabel}>権限</span>
            <span className={styles.itemValue}>{me.role === 'admin' ? '管理者' : 'メンバー'}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="section-title">チーム</h2>
        <div className={`card ${styles.group}`}>
          {isAdmin ? (
            <NameForm
              id="team-name"
              maxLength={60}
              label="チーム名（管理者が変更できます）"
              initial={team.name}
              onSave={(name) => run(() => repo.teams.rename(team.id, name), 'チーム名を変更しました')}
            />
          ) : (
            <div className={styles.item}>
              <span className={styles.itemLabel}>チーム名</span>
              <span className={styles.itemValue}>{team.name}</span>
            </div>
          )}
          <div className={styles.item}>
            <span className={styles.itemLabel}>メンバー</span>
            <span className={styles.itemValue}>{members.length}人</span>
          </div>
          <div className={styles.item}>
            <span className={styles.itemLabel}>予定を編集できる人</span>
            <span className={styles.itemValue}>
              {team.settings.eventEditPolicy === 'admins' ? '管理者のみ' : '全員'}
            </span>
          </div>
        </div>
      </section>

      {isAdmin && <AdminSettings />}

      <MemberList />

      <section className={styles.section}>
        <h2 className="section-title">アカウント</h2>
        <div className={styles.accountActions}>
          <button className="btn btn-secondary btn-block" onClick={signOut}>
            ログアウト
          </button>
          <button className={`btn btn-secondary btn-block ${styles.danger}`} disabled={isLastAdmin} onClick={leave}>
            チームを離れる
          </button>
          {isLastAdmin && (
            <p className="hint">
              あなたは最後の管理者のため、チームを離れられません。他のメンバーを管理者にしてください。
            </p>
          )}
        </div>
      </section>

      {isMock && (
        <section className={styles.mockBox}>
          <p className={styles.mockTitle}>モック用</p>
          <p className="hint">
            別のタブで別のアカウントにログインすると、変更がリアルタイムに反映される様子を確認できます。
          </p>
          <button className={`btn btn-secondary btn-sm ${styles.danger}`} onClick={resetMock}>
            データを初期状態に戻す
          </button>
        </section>
      )}
    </div>
  )
}

/** 名前を1つ編集する行。変更があるときだけ保存ボタンを出す */
function NameForm({
  id,
  label,
  initial,
  onSave,
  maxLength = 40,
}: {
  id: string
  label: string
  initial: string
  onSave(name: string): Promise<unknown>
  maxLength?: number
}) {
  const [draft, setDraft] = useState({ base: initial, value: initial })
  const dirty = draft.value !== draft.base && draft.value !== initial
  const name = dirty ? draft.value : initial
  const conflict = dirty && draft.base !== initial
  const [busy, setBusy] = useState(false)
  const changed = name.trim() !== '' && name.trim() !== initial

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (conflict || busy || !name.trim()) return
    setBusy(true)
    await onSave(name)
    setBusy(false)
  }

  return (
    <form className={styles.item} onSubmit={submit}>
      <label className={styles.itemLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inlineForm}>
        <input
          id={id}
          className="input"
          required
          maxLength={maxLength}
          value={name}
          onChange={(e) => setDraft({ base: dirty ? draft.base : initial, value: e.target.value })}
        />
        {changed && (
          <button className="btn btn-primary btn-sm" disabled={busy || conflict}>
            保存
          </button>
        )}
      </div>
      {conflict && (
        <div role="alert">
          <p>名前が別の操作で変更されました。</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDraft({ base: initial, value: initial })}
          >
            最新の名前に戻す
          </button>
        </div>
      )}
    </form>
  )
}
