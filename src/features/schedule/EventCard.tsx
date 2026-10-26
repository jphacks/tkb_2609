import type { CSSProperties } from 'react'
import { ClockIcon, PinIcon } from '../../components/icons'
import { formatDate, formatTime, relativeDay } from '../../lib/format'
import type { EventType, TeamEvent } from '../../types'
import { AttendanceButtons, AttendanceCapacityHint } from './AttendanceButtons'
import styles from './schedule.module.css'
import { useMyAttendance } from './useMyAttendance'

export function EventCard({ event, type, onOpen }: { event: TeamEvent; type?: EventType; onOpen(): void }) {
  const [myStatus, changeStatus] = useMyAttendance(event)
  const relative = relativeDay(event.startAt)

  return (
    <article className={styles.card} style={{ '--type-color': type?.color ?? 'var(--text-muted)' } as CSSProperties}>
      <button className={styles.cardMain} onClick={onOpen}>
        <div className={styles.cardTop}>
          <span className={styles.date}>{formatDate(event.startAt)}</span>
          {relative && <span className={styles.relative}>{relative}</span>}
          <span className={styles.typeBadge}>{type?.label ?? '予定'}</span>
        </div>
        <h2 className={styles.cardTitle}>{event.title}</h2>
        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <ClockIcon size={15} />
            集合 {formatTime(event.startAt)}
          </span>
          {event.place && (
            <span className={`${styles.metaItem} ${styles.place}`}>
              <PinIcon size={15} />
              {event.place}
            </span>
          )}
        </div>
      </button>
      <AttendanceButtons value={myStatus} onChange={changeStatus} />
      <AttendanceCapacityHint count={Object.keys(event.attendance).length} />
    </article>
  )
}
