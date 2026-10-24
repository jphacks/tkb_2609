import { useState, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Sheet } from '../../components/Sheet'
import { isDuplicateEquipmentName } from '../../lib/equipment'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

export function EquipmentForm({
  item,
  items,
  onClose,
}: {
  item?: EquipmentItem
  /** 名前の重複チェック用 */
  items: EquipmentItem[]
  onClose(): void
}) {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const [name, setName] = useState(item?.name ?? '')
  const [busy, setBusy] = useState(false)
  const duplicate = name.trim() !== '' && isDuplicateEquipmentName(items, name, item?.id)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (duplicate) return
    setBusy(true)
    const input = { name: name.trim() }
    const ok = await run(
      () => (item ? repo.equipment.update(team.id, item.id, input) : repo.equipment.add(team.id, input)),
      item ? '用具を更新しました' : `${input.name}を追加しました`,
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet title={item ? '用具を編集' : '用具を追加'} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <label className="field">
          <span className="label">用具名</span>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="救急箱"
            aria-invalid={duplicate}
          />
          {duplicate && <span className="error-text">同じ名前の用具がすでにあります</span>}
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim() || duplicate}>
          {item ? '保存する' : '追加する'}
        </button>
      </form>
    </Sheet>
  )
}
