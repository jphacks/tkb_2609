import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Sheet } from '../../components/Sheet'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

/** 用具ごとのメニュー。編集・削除は全員、強制的に手放させるのは管理者のみ */
export function EquipmentMenu({ item, onEdit, onClose }: { item: EquipmentItem; onEdit(): void; onClose(): void }) {
  const repo = useRepository()
  const { team, user, isAdmin } = useSession()
  const { run, confirm } = useFeedback()
  const canForceRelease = isAdmin && item.holderUid !== null && item.holderUid !== user.uid

  const forceRelease = async () => {
    onClose()
    const ok = await confirm({
      title: `${item.holderName}さんの${item.name}を手放させますか？`,
      message: '管理者の操作として、この用具は「誰も持っていない」状態になります。',
      confirmLabel: '手放させる',
      danger: true,
    })
    if (ok) await run(() => repo.equipment.forceRelease(team.id, item.id), `${item.name}を手放させました`)
  }

  const remove = async () => {
    onClose()
    const ok = await confirm({
      title: `${item.name}を削除しますか？`,
      message: 'チーム全員の用具一覧から削除されます。',
      confirmLabel: '削除',
      danger: true,
    })
    if (ok) await run(() => repo.equipment.remove(team.id, item.id), `${item.name}を削除しました`)
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className={styles.menu}>
        <button className="btn btn-secondary btn-block" onClick={onEdit}>
          名前を編集
        </button>
        {canForceRelease && (
          <button className="btn btn-secondary btn-block" onClick={forceRelease}>
            {item.holderName}さんから手放させる（管理者）
          </button>
        )}
        <button className={`btn btn-secondary btn-block ${styles.danger}`} onClick={remove}>
          削除
        </button>
      </div>
    </Sheet>
  )
}
