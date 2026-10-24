import { useState, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Sheet } from '../../components/Sheet'
import { equipmentNameError, isDuplicateEquipmentName } from '../../lib/equipment'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

export function EquipmentForm({
  item,
  items,
  onClose,
}: {
  item?: EquipmentItem
  items: EquipmentItem[]
  onClose(): void
}) {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const initial = item?.name ?? ''
  const [draft, setDraft] = useState({ base: initial, value: initial })
  const dirty = draft.value !== draft.base && draft.value !== initial
  const name = dirty ? draft.value : initial
  const conflict = dirty && draft.base !== initial
  const [busy, setBusy] = useState(false)
  const duplicate = name.trim() !== '' && isDuplicateEquipmentName(items, name, item?.id)
  const validation = name ? equipmentNameError(name) : null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (duplicate || conflict || equipmentNameError(name) || busy) return
    setBusy(true)
    const input = { name: name.normalize('NFKC').trim() }
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
            maxLength={100}
            value={name}
            onChange={(e) => setDraft({ base: dirty ? draft.base : initial, value: e.target.value })}
            placeholder="救急箱"
            aria-invalid={duplicate || !!validation}
            aria-describedby="equipment-name-error"
          />
          <span id="equipment-name-error" className="error-text">
            {duplicate ? '同じ名前の用具がすでにあります' : validation}
          </span>
        </label>
        {conflict && (
          <div role="alert">
            <p>別の操作で用具名が変更されました。最新の名前を確認してください。</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft({ base: initial, value: initial })}
            >
              最新の名前に戻す
            </button>
          </div>
        )}
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !name.trim() || duplicate || !!validation || conflict}
        >
          {item ? '保存する' : '追加する'}
        </button>
      </form>
    </Sheet>
  )
}
