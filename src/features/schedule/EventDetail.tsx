import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useSubscription } from '../../app/useSubscription'
import { useFeedback } from '../../components/feedback/context'
import { ClockIcon, PinIcon, TrashIcon } from '../../components/icons'
import { Layer } from '../../components/Layer'
import { ATTENDANCE_OPTIONS, statusOf } from '../../lib/attendance'
import { formatDate, formatDateTime, formatTime } from '../../lib/format'
import type { EventNote, TeamEvent } from '../../types'
import { AttendanceButtons } from './AttendanceButtons'
import styles from './schedule.module.css'
import { useMyAttendance } from './useMyAttendance'

export function EventDetail({ event, onBack, onEdit }: { event?: TeamEvent; onBack(): void; onEdit(): void }) {
  // 一度表示した予定が消えたら（他の人が削除したら）一覧に戻る。
  // 作成直後はまだ届いていないだけなので戻らない
  const [seen, setSeen] = useState(false)
  if (event && !seen) setSeen(true)
  useEffect(() => {
    if (!event && seen) onBack()
  }, [event, seen, onBack])

  if (!event) return null
  return <EventDetailBody event={event} onBack={onBack} onEdit={onEdit} />
}

function EventDetailBody({ event, onBack, onEdit }: { event: TeamEvent; onBack(): void; onEdit(): void }) {
  const repo = useRepository()
  const { team, members, canEditEvents } = useSession()
  const { run, confirm } = useFeedback()
  const [myStatus, changeStatus] = useMyAttendance(event)
  const type = team.settings.eventTypes.find((t) => t.id === event.typeId)

  const remove = async () => {
    const ok = await confirm({
      title: 'この予定を削除しますか？',
      message: '出欠とメモもすべて削除されます。',
      confirmLabel: '削除',
      danger: true,
    })
    if (ok && (await run(() => repo.events.remove(team.id, event.id), '予定を削除しました'))) onBack()
  }

  return (
    <Layer
      title="予定の詳細"
      onBack={onBack}
      actions={
        canEditEvents && (
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            編集
          </button>
        )
      }
    >
      <div className={styles.detail}>
        <section
          className={`card ${styles.detailHead}`}
          style={{ '--type-color': type?.color ?? 'var(--text-muted)' } as CSSProperties}
        >
          <div className={styles.cardTop}>
            <span className={styles.date}>{formatDate(event.startAt)}</span>
            <span className={styles.typeBadge}>{type?.label ?? '予定'}</span>
          </div>
          <h2 className={styles.detailTitle}>{event.title}</h2>
          <div className={styles.detailMeta}>
            <span className={styles.metaItem}>
              <ClockIcon size={16} />
              集合 {formatTime(event.startAt)}
            </span>
            <span className={styles.metaItem}>
              <PinIcon size={16} />
              {event.place ?? '場所未定'}
            </span>
          </div>
        </section>

        <section className={styles.detailSection}>
          <h3 className="section-title">あなたの出欠</h3>
          <AttendanceButtons value={myStatus} onChange={changeStatus} />
        </section>

        <section className={styles.detailSection}>
          <h3 className="section-title">全員の出欠（{members.length}人）</h3>
          <div className="card">
            {ATTENDANCE_OPTIONS.map(({ status, label, color }) => {
              const names = members
                .filter((m) => statusOf(event.attendance, m.uid) === status)
                .map((m) => m.displayName)
              return (
                <div key={status} className={styles.attRow} style={{ '--att-color': color } as CSSProperties}>
                  <div className={styles.attRowHead}>
                    <span className={styles.attDot} />
                    <span className={styles.attLabel}>{label}</span>
                    <span className={styles.attCount}>{names.length}人</span>
                  </div>
                  {names.length > 0 && <p className={styles.attNames}>{names.join('、')}</p>}
                </div>
              )
            })}
          </div>
        </section>

        <Notes eventId={event.id} />

        {canEditEvents && (
          <button className={`btn btn-secondary btn-block ${styles.deleteButton}`} onClick={remove}>
            この予定を削除
          </button>
        )}
      </div>
    </Layer>
  )
}

/** 全員が書けるメモ。1件ずつ積み上げ、自分の書き込みだけ削除できる */
function Notes({ eventId }: { eventId: string }) {
  const repo = useRepository()
  const { team, user } = useSession()
  const { run, confirm } = useFeedback()
  const notes = useSubscription<EventNote[]>(
    (cb) => repo.events.subscribeNotes(team.id, eventId, cb),
    [team.id, eventId],
  )
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    if (await run(() => repo.events.addNote(team.id, eventId, body))) setBody('')
    setBusy(false)
  }

  const remove = async (noteId: string) => {
    const ok = await confirm({ title: 'このメモを削除しますか？', confirmLabel: '削除', danger: true })
    if (ok) await run(() => repo.events.removeNote(team.id, eventId, noteId))
  }

  return (
    <section className={styles.detailSection}>
      <h3 className="section-title">メモ</h3>
      <div className={`card ${styles.notes}`}>
        {notes === undefined ? (
          <p className="muted">読み込み中…</p>
        ) : notes.length === 0 ? (
          <p className="muted">まだメモはありません</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className={styles.note}>
              <div className={styles.noteHead}>
                <span className={styles.noteAuthor}>{note.authorName}</span>
                <span className="muted">{formatDateTime(note.createdAt)}</span>
                {note.authorUid === user.uid && (
                  <button
                    className={`icon-btn ${styles.noteDelete}`}
                    onClick={() => remove(note.id)}
                    aria-label="メモを削除"
                  >
                    <TrashIcon size={17} />
                  </button>
                )}
              </div>
              <p className={styles.noteBody}>{note.body}</p>
            </div>
          ))
        )}

        <form className={styles.noteForm} onSubmit={submit}>
          <textarea
            className="input"
            rows={2}
            aria-label="メモを書く"
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="連絡事項や持ち物などを書き込めます"
          />
          <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
            書き込む
          </button>
        </form>
      </div>
    </section>
  )
}
