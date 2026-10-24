import { useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { MoreIcon } from '../../components/icons'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

export function EquipmentRow({ item, onMenu }: { item: EquipmentItem; onMenu(): void }) {
  const repo = useRepository()
  const { team, user } = useSession()
  const { run } = useFeedback()
  const [busy, setBusy] = useState(false)
  const held = item.holderUid !== null
  const isMine = item.holderUid === user.uid

  const hold = async () => {
    setBusy(true)
    await run(() => repo.equipment.hold(team.id, item.id), `${item.name}を持ちました`)
    setBusy(false)
  }

  return (
    <div data-flip-id={item.id} className={`${styles.row} ${held ? styles.rowHeld : styles.rowFree}`}>
      <span className={styles.rowName}>{item.name}</span>

      {held ? (
        <span className={`${styles.holderChip} ${isMine ? styles.holderChipMine : ''}`}>
          {isMine ? 'あなた' : item.holderName}
        </span>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={hold}>
          持つ
        </button>
      )}

      <button className={`icon-btn ${styles.more}`} onClick={onMenu} aria-label={`${item.name}のメニュー`}>
        <MoreIcon size={20} />
      </button>
    </div>
  )
}
