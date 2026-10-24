import { useEffect, useState } from 'react'
import { useRepository } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import type { AuthUser } from '../../types'
import styles from './auth.module.css'

/**
 * 登録したメールアドレスの確認待ち（#39）。確認メールのリンクを開くまで、チームの作成・参加はできない。
 * メールアプリから戻ってきたときは、自動で確認状態を読み直す
 */
export function VerifyEmailScreen({ user }: { user: AuthUser }) {
  const repo = useRepository()
  const { run, toast } = useFeedback()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void repo.auth.reloadUser().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [repo])

  const check = async () => {
    setBusy(true)
    const ok = await run(() => repo.auth.reloadUser())
    setBusy(false)
    // 確認済みになると App が次の画面に切り替えるため、ここに残るのは未確認のときだけ
    if (ok) toast('まだ確認が完了していません。メールのリンクを開いてから、もう一度お試しください')
  }

  const resend = async () => {
    setBusy(true)
    await run(() => repo.auth.sendEmailVerification(), '確認メールを再送しました')
    setBusy(false)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.heading}>
        <h1 className={styles.title}>メールアドレスを確認してください</h1>
        <p className="muted">
          <strong>{user.email}</strong> に確認メールを送りました。メールのリンクを開くと、チームの作成・参加ができるようになります。
        </p>
      </div>

      <div className={styles.form}>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={check}>
          確認しました
        </button>
        <button className="btn btn-secondary btn-block" disabled={busy} onClick={resend}>
          確認メールを再送
        </button>
        <p className="hint">メールが届かないときは、迷惑メールフォルダも確認してください。メールアドレスを間違えた場合は、ログアウトして登録し直してください。</p>
      </div>

      <div className={styles.switch}>
        <button className="btn btn-ghost btn-sm" onClick={() => run(() => repo.auth.signOut())}>
          ログアウト
        </button>
      </div>
    </div>
  )
}
