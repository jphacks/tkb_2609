import { useMemo, useRef, useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useSubscription } from '../../app/useSubscription'
import { PlusIcon } from '../../components/icons'
import { sortEquipment } from '../../lib/equipment'
import type { EquipmentItem } from '../../types'
import { EquipmentForm } from './EquipmentForm'
import { EquipmentMenu } from './EquipmentMenu'
import { EquipmentRow } from './EquipmentRow'
import styles from './equipment.module.css'
import { MyItemsWidget } from './MyItemsWidget'
import { useFlipAnimation } from './useFlipAnimation'

type Panel = { kind: 'add' } | { kind: 'edit'; item: EquipmentItem } | { kind: 'menu'; item: EquipmentItem } | null

export function EquipmentTab() {
  const repo = useRepository()
  const { team, user } = useSession()
  const items = useSubscription<EquipmentItem[]>((cb) => repo.equipment.subscribe(team.id, cb), [team.id])
  const [panel, setPanel] = useState<Panel>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => sortEquipment(items ?? []), [items])
  const mine = useMemo(() => sorted.filter((item) => item.holderUid === user.uid), [sorted, user.uid])
  useFlipAnimation(listRef, sorted.map((item) => item.id).join())

  if (items === undefined) {
    return <div className={styles.skeleton} aria-busy="true" />
  }

  return (
    <div className={styles.page}>
      <MyItemsWidget items={mine} />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className="section-title">
            用具一覧（{items.length}）・空き {items.filter((i) => !i.holderUid).length}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setPanel({ kind: 'add' })}>
            <PlusIcon size={18} />
            追加
          </button>
        </div>

        {items.length === 0 ? (
          <p className={styles.empty}>まだ用具が登録されていません</p>
        ) : (
          <div ref={listRef} className={styles.list}>
            {sorted.map((item) => (
              <EquipmentRow key={item.id} item={item} onMenu={() => setPanel({ kind: 'menu', item })} />
            ))}
          </div>
        )}
      </section>

      {panel?.kind === 'add' && <EquipmentForm onClose={() => setPanel(null)} />}
      {panel?.kind === 'edit' && <EquipmentForm item={panel.item} onClose={() => setPanel(null)} />}
      {panel?.kind === 'menu' && (
        <EquipmentMenu
          item={panel.item}
          onEdit={() => setPanel({ kind: 'edit', item: panel.item })}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  )
}
