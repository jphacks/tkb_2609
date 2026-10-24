import type { ReactNode } from 'react'
import styles from './Sheet.module.css'

/** 画面下からせり上がるパネル。用具の追加・編集やメニューに使う */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} />
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
