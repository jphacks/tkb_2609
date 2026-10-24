import { useState, type CSSProperties, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Layer } from '../../components/Layer'
import { fromDateTimeInput, toDateInput, toTimeInput } from '../../lib/format'
import type { TeamEvent } from '../../types'
import styles from './schedule.module.css'

/** 予定の作成・編集。完了したら表示する予定の id を返す */
export function EventForm({ event, onDone }: { event?: TeamEvent; onDone(eventId?: string): void }) {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const types = team.settings.eventTypes

  const [typeId, setTypeId] = useState(event?.typeId ?? types[0]?.id ?? '')
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(() => toDateInput(event?.startAt ?? new Date()))
  const [time, setTime] = useState(event ? toTimeInput(event.startAt) : '16:00')
  const [place, setPlace] = useState(event?.place ?? '')
  // 追加時のみ。予定の詳細のメモ欄に、最初の書き込みとして入る
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const input = { typeId, title: title.trim(), startAt: fromDateTimeInput(date, time), place: place.trim() || null }
    let id = event?.id
    const ok = await run(async () => {
      if (event) {
        await repo.events.update(team.id, event.id, input)
      } else {
        const newId = await repo.events.create(team.id, input)
        id = newId
        if (note.trim()) await repo.events.addNote(team.id, newId, note)
      }
    }, event ? '予定を更新しました' : '予定を追加しました')
    setBusy(false)
    if (ok) onDone(id)
  }

  return (
    <Layer title={event ? '予定を編集' : '予定を追加'} onBack={() => onDone(event?.id)}>
      <form className={styles.form} onSubmit={submit}>
        <div className="field">
          <span className="label">種類</span>
          <div className={styles.typeChoices} role="radiogroup">
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={typeId === type.id}
                className={styles.typeChoice}
                style={{ '--type-color': type.color } as CSSProperties}
                onClick={() => setTypeId(type.id)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="label">予定名</span>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="放課後練習" />
        </label>

        <div className={styles.formRow}>
          <label className="field">
            <span className="label">日付</span>
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">集合時間</span>
            <input className="input" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="label">場所（任意）</span>
          <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="第2グラウンド" />
        </label>

        {!event && (
          <label className="field">
            <span className="label">メモ（任意）</span>
            <textarea
              className="input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="持ち物や連絡事項など"
            />
            <span className="hint">予定の詳細のメモ欄に、あなたの書き込みとして追加されます</span>
          </label>
        )}

        <button className="btn btn-primary btn-block" disabled={busy || !title.trim() || !date || !time}>
          {event ? '保存する' : '追加する'}
        </button>
      </form>
    </Layer>
  )
}
