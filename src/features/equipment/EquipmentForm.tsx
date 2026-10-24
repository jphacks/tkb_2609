import { useState, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Sheet } from '../../components/Sheet'
import type { EquipmentItem } from '../../types'
import styles from './equipment.module.css'

export function EquipmentForm({ item, onClose }: { item?: EquipmentItem; onClose(): void }) {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const [name, setName] = useState(item?.name ?? '')
  const [reading, setReading] = useState(item?.reading ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const input = { name: name.trim(), reading: reading.trim() || null }
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
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="救急箱" />
        </label>
        <label className="field">
          <span className="label">よみがな（任意）</span>
          <input
            className="input"
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            placeholder="きゅうきゅうばこ"
          />
          <span className="hint">漢字の用具名を50音順に並べるために使います</span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {item ? '保存する' : '追加する'}
        </button>
      </form>
    </Sheet>
  )
}
