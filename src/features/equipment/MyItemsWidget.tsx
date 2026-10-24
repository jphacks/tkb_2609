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
  const [busyId, setBusyId] = useState<string | null>(null)

  const release = async (item: EquipmentItem) => {
    setBusyId(item.id)
    await run(() => repo.equipment.release(team.id, item.id), `${item.name}を手放しました`)
    setBusyId(null)
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
        <ul className={styles.widgetList}>
          {items.map((item) => (
            <li key={item.id} className={styles.widgetRow}>
              <span className={styles.widgetName}>{item.name}</span>
              <button className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => release(item)}>
                手放す
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
