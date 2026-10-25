import { useState, type FormEvent } from 'react'
import type { AuthUser, UserProfile } from '../../types'
import { useRepository } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Layer } from '../../components/Layer'
import { PasswordInput } from '../../components/PasswordInput'
import { detectInAppBrowser } from '../../lib/inAppBrowser'
import styles from './settings.module.css'

/** チーム未所属・削除途中でもアクセスできるアカウント全体の設定。 */
export function AccountSettings({ user, profile, onBack }: { user: AuthUser; profile: UserProfile | null; onBack?: () => void }) {
  const repo = useRepository()
  const { confirm, run } = useFeedback()
  const [name, setName] = useState(profile?.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<'password' | 'google'>(user.providers?.includes('google.com') ? 'google' : 'password')
  const blockedGoogle = method === 'google' && !!detectInAppBrowser(navigator.userAgent)
  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    await run(() => repo.users.updateAccountName(name), 'アカウント名を変更しました')
    setBusy(false)
  }
  const reset = async () => {
    if (busy) return
    setBusy(true)
    await run(() => repo.auth.sendPasswordReset(user.email), 'パスワード再設定メールを送りました')
    setBusy(false)
  }
  const cancelDeletion = async () => {
    const ok = await confirm({ title: '削除を中断しますか？', message: 'すでに離れたチームの所属は戻りません。残りのチームで管理者を変更したい場合も、いったん中断してください。', confirmLabel: '削除を中断' })
    if (!ok) return
    setBusy(true)
    await run(() => repo.auth.cancelAccountDeletion(), '削除を中断しました')
    setBusy(false)
  }
  const startDeletion = async () => {
    if (await confirm({ title: 'アカウントを削除しますか？', message: '全チームから離れ、持っている用具を手放し、アカウントを削除します。投稿済みのメモや出欠など、チームの記録は残ります。元に戻せません。最後の管理者になっているチームがある場合は削除できません。', confirmLabel: '本人確認へ進む', danger: true })) setDeleting(true)
  }
  const remove = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || confirmation !== '削除' || blockedGoogle) return
    setBusy(true)
    // Google の再認証はこのクリックの直後に呼ぶ。
    await run(() => repo.auth.deleteAccount({ confirmation, password: method === 'password' ? password : undefined }), 'アカウントを削除しました')
    setPassword('')
    setBusy(false)
  }
  return (
    <Layer title="アカウント設定" onBack={!busy ? onBack : undefined}>
      <div className={styles.accountPage}>
        {(profile?.deletingAccount || !profile) && <p role="status">プロフィールを取得できないか、アカウント削除の途中です。通信状態を確認してください。削除を再開する場合は「アカウントを削除」から本人確認してください。解除済みの所属は元に戻りません。</p>}
        {profile?.deletingAccount && <button className="btn btn-secondary" disabled={busy} onClick={cancelDeletion}>削除を中断して設定に戻る</button>}
        <p className="hint">{user.email}</p>
        {profile && !profile.deletingAccount && <>
          <section className={styles.section}>
            <h2 className="section-title">アカウント名</h2>
            <form className={styles.accountActions} onSubmit={saveName}>
              <label className="field"><span className="label">アカウント名</span><input className="input" required maxLength={40} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
              <p className="hint">アカウント全体の名前です。各チームでの名前や Google アカウントの名前は変わりません。</p>
              <button className="btn btn-primary" disabled={busy || !name.trim() || name.trim() === profile.displayName}>アカウント名を保存</button>
            </form>
          </section>
          <section className={styles.section}>
            <h2 className="section-title">パスワードの再設定</h2>
            <p className="hint">登録したメールアドレスに再設定メールを送ります。BUKATSU 用のパスワードを設定します。Google アカウントのパスワードは変わりません。</p>
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={reset}>再設定メールを送る</button>
          </section>
        </>}
        <section className={styles.section}>
          <h2 className="section-title">アカウント削除</h2>
          {!deleting ? <button className="btn btn-danger btn-block" disabled={busy} onClick={startDeletion}>アカウントを削除</button> : (
            <form className={styles.accountActions} onSubmit={remove}>
              <p>削除すると元に戻せません。本人確認後、削除を実行します。</p>
              {user.providers?.includes('google.com') && user.providers.includes('password') && <label className="field"><span className="label">本人確認の方法</span><select className="input" value={method} disabled={busy} onChange={(e) => setMethod(e.target.value as 'password' | 'google')}><option value="google">Google</option><option value="password">パスワード</option></select></label>}
              {method === 'password' && <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}><PasswordInput label="現在のパスワード" autoComplete="current-password" value={password} onChange={setPassword} /></fieldset>}
              {method === 'google' && <p className="hint">Google で再度本人確認します。同じ Google アカウントを選んでください。</p>}
              {blockedGoogle && <p role="alert">Google での本人確認には Safari などの外部ブラウザで開いてください。</p>}
              <label className="field"><span className="label">確認のため「削除」と入力</span><input className="input" value={confirmation} disabled={busy} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></label>
              <button className="btn btn-danger" disabled={busy || confirmation !== '削除' || blockedGoogle || (method === 'password' && !password)}>本人確認してアカウントを削除</button>
              <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => { setDeleting(false); setPassword(''); setConfirmation('') }}>キャンセル</button>
            </form>
          )}
        </section>
        <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => run(() => repo.auth.signOut())}>ログアウト</button>
      </div>
    </Layer>
  )
}
