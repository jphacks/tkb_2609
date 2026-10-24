import { useEffect, type ReactNode } from 'react'
import { PageHeader } from './PageHeader'
import styles from './Layer.module.css'

/**
 * タブの上に重ねて表示する画面（予定の詳細・編集など）。
 * スマホでは全画面、幅の広い画面では中央のパネルとして表示し、外側を押すと閉じる。
 */
export function Layer({
  title,
  onBack,
  actions,
  children,
}: {
  title: string
  onBack(): void
  actions?: ReactNode
  children: ReactNode
}) {
  // 背面のタブがスクロールしないようにする
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onBack()}>
      <div className={styles.layer}>
        <PageHeader title={title} onBack={onBack} actions={actions} />
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
