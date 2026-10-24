import type { ReactNode } from 'react'
import { useRefresh } from '../app/contexts'
import { BackIcon, RefreshIcon } from './icons'
import styles from './PageHeader.module.css'

/**
 * 画面上部のヘッダー。右端に必ず再取得ボタンを置く
 * （iPhone のショートカットから開くとブラウザのリロードが押せないため）。
 */
export function PageHeader({ title, onBack, actions }: { title: string; onBack?(): void; actions?: ReactNode }) {
  const { refresh, refreshing } = useRefresh()

  return (
    <header className={styles.header}>
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <BackIcon />
        </button>
      )}
      <h1 className={styles.title}>{title}</h1>
      {actions}
      <button
        className={`icon-btn ${refreshing ? styles.spinning : ''}`}
        onClick={refresh}
        aria-label="最新の情報に更新"
      >
        <RefreshIcon size={22} />
      </button>
    </header>
  )
}
