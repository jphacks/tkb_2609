import { useState, type CSSProperties, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { Layer } from '../../components/Layer'
import { formatDate, fromDateTimeInput, toDateInput, toTimeInput } from '../../lib/format'
import { MAX_WEEKLY_EVENTS, weeklyDates } from '../../lib/weekly'
import type { TeamEvent } from '../../types'
import styles from './schedule.module.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 予定の作成・編集。完了したら表示する予定の id を返す（毎週の一括追加では一覧へ戻る） */
export function EventForm({ event, onDone }: { event?: TeamEvent; onDone(eventId?: string): void }) {
  const repo = useRepository()
  const { team, canEditEvents } = useSession()
  const { run } = useFeedback()
  const types = team.settings.eventTypes

  const [typeId, setTypeId] = useState(event?.typeId ?? types[0]?.id ?? '')
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(() => toDateInput(event?.startAt ?? new Date()))
  const [time, setTime] = useState(event ? toTimeInput(event.startAt) : '16:00')
  const [place, setPlace] = useState(event?.place ?? '')
  // 追加時のみ。予定の詳細のメモ欄に、最初の書き込みとして入る
  const [note, setNote] = useState('')
  // 追加時のみ。毎週の予定を、期間を決めて一度に追加する（#44）
  const [weekly, setWeekly] = useState(false)
  const [weekdays, setWeekdays] = useState(() => [new Date().getDay()])
  const [endDate, setEndDate] = useState(() => {
    const end = new Date()
    end.setDate(end.getDate() + 27)
    return toDateInput(end)
  })
  const [busy, setBusy] = useState(false)

  const dates = weekly ? weeklyDates(date, endDate, weekdays, time) : []
  const tooMany = dates.length > MAX_WEEKLY_EVENTS

  const toggleWeekday = (day: number) =>
    setWeekdays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEditEvents) return
    setBusy(true)
    const base = { typeId, title: title.trim(), place: place.trim() || null }
    let id = event?.id
    if (weekly) {
      const ok = await run(
        () => repo.events.createMany(team.id, dates.map((startAt) => ({ ...base, startAt }))),
        `${dates.length}件の予定を追加しました`,
      )
      setBusy(false)
      if (ok) onDone()
      return
    }
    const input = { ...base, startAt: fromDateTimeInput(date, time) }
    const ok = await run(
      async () => {
        if (event) {
          await repo.events.update(team.id, event.id, input)
        } else {
          const newId = await repo.events.create(team.id, input, note)
          id = newId
        }
      },
      event ? '予定を更新しました' : '予定を追加しました',
    )
    setBusy(false)
    if (ok) onDone(id)
  }

  return (
    <Layer title={event ? '予定を編集' : '予定を追加'} onBack={() => onDone(event?.id)}>
      <form className={styles.form} onSubmit={submit}>
        {!event && (
          <div className={styles.segment} role="radiogroup" aria-label="繰り返し">
            <button type="button" role="radio" aria-checked={!weekly} onClick={() => setWeekly(false)}>
              1回だけ
            </button>
            <button type="button" role="radio" aria-checked={weekly} onClick={() => setWeekly(true)}>
              毎週
            </button>
          </div>
        )}

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
          <input
            className="input"
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="放課後練習"
          />
        </label>

        {weekly ? (
          <>
            <div className="field">
              <span className="label">曜日</span>
              <div className={styles.weekdays} role="group" aria-label="曜日">
                {WEEKDAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={weekdays.includes(day)}
                    className={styles.weekday}
                    onClick={() => toggleWeekday(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.formRow}>
              <label className="field">
                <span className="label">開始日</span>
                <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">終了日</span>
                <input
                  className="input"
                  type="date"
                  required
                  min={date}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span className="label">集合時間</span>
              <input className="input" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </>
        ) : (
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
        )}

        <label className="field">
          <span className="label">場所（任意）</span>
          <input
            className="input"
            maxLength={200}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="第2グラウンド"
          />
        </label>

        {!event && !weekly && (
          <label className="field">
            <span className="label">メモ（任意）</span>
            <textarea
              className="input"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="持ち物や連絡事項など"
            />
            <span className="hint">予定の詳細のメモ欄に、あなたの書き込みとして追加されます</span>
          </label>
        )}

        {weekly && (
          <div className="field">
            <span className="label">追加される日付</span>
            {tooMany ? (
              <p className={styles.weeklyError}>
                一度に追加できるのは{MAX_WEEKLY_EVENTS}件までです。期間を短くしてください
              </p>
            ) : dates.length === 0 ? (
              <p className="hint">曜日と期間を選ぶと、ここに日付が表示されます</p>
            ) : (
              <ul className={styles.weeklyDates} aria-label="追加される日付">
                {dates.map((d) => (
                  <li key={d.getTime()}>{formatDate(d)}</li>
                ))}
              </ul>
            )}
            <span className="hint">追加後は1件ずつ編集・削除できます</span>
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          disabled={
            busy || !canEditEvents || !title.trim() || !date || !time || (weekly && (dates.length === 0 || tooMany))
          }
        >
          {event ? '保存する' : weekly && dates.length > 0 && !tooMany ? `${dates.length}件の予定を追加する` : '追加する'}
        </button>
      </form>
    </Layer>
  )
}
