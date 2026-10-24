import { useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

/** 画面上部の「自分の状態」。持っている用具ごとに「手放す」ボタンを置く */
export function MyItemsWidget({ items }: { items: EquipmentItem[] }) {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const [busyIds, setBusyIds] = useState(new Set<string>())

  const release = async (item: EquipmentItem) => {
    setBusyIds((previous) => new Set(previous).add(item.id))
    await run(() => repo.equipment.release(team.id, item.id), `${item.name}を手放しました`)
    setBusyIds((previous) => {
      const next = new Set(previous)
      next.delete(item.id)
      return next
    })
  }

  return (
    <section className={styles.widget} aria-label="あなたが持っている用具">
      <div className={styles.widgetHead}>
        <h2 className={styles.widgetTitle}>あなたが持っている用具</h2>
        <span className={styles.widgetCount}>{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className={styles.widgetRow}>
          <span className="muted">持っている用具はありません</span>
          <button className="btn btn-secondary btn-sm" disabled>
            手放す
          </button>
        </div>
      ) : (
        <ul className={styles.widgetList} tabIndex={0} aria-label="所持用具の一覧">
          {items.map((item) => (
            <li key={item.id} className={styles.widgetRow}>
              <span className={styles.widgetName}>{item.name}</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busyIds.has(item.id)}
                aria-label={`${item.name}を手放す`}
                onClick={() => release(item)}
              >
                手放す
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
