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

  const signOut = async () => {
    const ok = await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' })
    if (ok) await run(() => repo.auth.signOut())
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
          <DisplayNameForm />
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
          <div className={styles.item}>
            <span className={styles.itemLabel}>チーム名</span>
            <span className={styles.itemValue}>{team.name}</span>
          </div>
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

      <button className="btn btn-secondary btn-block" onClick={signOut}>
        ログアウト
      </button>

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

function DisplayNameForm() {
  const repo = useRepository()
  const { me } = useSession()
  const { run } = useFeedback()
  const [name, setName] = useState(me.displayName)
  const [busy, setBusy] = useState(false)
  const changed = name.trim() !== '' && name.trim() !== me.displayName

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await run(() => repo.users.updateDisplayName(name), '名前を変更しました')
    setBusy(false)
  }

  return (
    <form className={styles.item} onSubmit={submit}>
      <label className={styles.itemLabel} htmlFor="display-name">
        名前
      </label>
      <div className={styles.inlineForm}>
        <input id="display-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        {changed && (
          <button className="btn btn-primary btn-sm" disabled={busy}>
            保存
          </button>
        )}
      </div>
    </form>
  )
}
