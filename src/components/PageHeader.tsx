import type { ReactNode } from 'react'
import { useRefresh } from '../app/contexts'
import { BackIcon, RefreshIcon } from './icons'
import styles from './PageHeader.module.css'

/**
 * 画面上部のヘッダー。右端に必ず再取得ボタンを置く
 * （iPhone のショートカットから開くとブラウザのリロードが押せないため）。
 * titleControl を渡すと、タイトルの位置にその部品（チームの選択欄など）を置き、見出しは読み上げ用だけにする
 */
export function PageHeader({
  title,
  titleControl,
  onBack,
  actions,
}: {
  title: string
  titleControl?: ReactNode
  onBack?(): void
  actions?: ReactNode
}) {
  const { refresh, refreshing } = useRefresh()

  return (
    <header className={styles.header}>
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <BackIcon />
        </button>
      )}
      <h1 className={titleControl ? 'visually-hidden' : styles.title}>{title}</h1>
      {titleControl}
      {actions}
      <button
        className={`icon-btn ${refreshing ? styles.spinning : ''}`}
        onClick={refresh}
        aria-label="最新の情報に更新"
        aria-busy={refreshing}
      >
        <RefreshIcon size={22} />
      </button>
    </header>
  )
}
