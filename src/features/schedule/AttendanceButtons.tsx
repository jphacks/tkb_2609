import type { CSSProperties } from 'react'
import { ATTENDANCE_OPTIONS } from '../../lib/attendance'
import type { AttendanceStatus } from '../../types'
import styles from './schedule.module.css'

/** 出欠の5ボタン。常に表示し、選択中のものを塗りつぶす */
export function AttendanceButtons({
  value,
  onChange,
}: {
  value: AttendanceStatus
  onChange(status: AttendanceStatus): void
}) {
  return (
    <div className={styles.attendance} role="radiogroup" aria-label="自分の出欠">
      {ATTENDANCE_OPTIONS.map(({ status, label, color }) => (
        <button
          key={status}
          role="radio"
          aria-checked={value === status}
          className={styles.attButton}
          style={{ '--att-color': color } as CSSProperties}
          onClick={() => onChange(status)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
