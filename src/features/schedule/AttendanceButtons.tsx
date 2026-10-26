import type { CSSProperties } from 'react'
import { ATTENDANCE_OPTIONS, MAX_STORED_ATTENDANCE } from '../../lib/attendance'
import type { AttendanceStatus } from '../../types'
import styles from './schedule.module.css'

export function AttendanceCapacityHint({ count }: { count: number }) {
  return count >= MAX_STORED_ATTENDANCE - 50 ? <p className="hint" role="status">出席以外の回答は{count} / {MAX_STORED_ATTENDANCE}件です。上限に達すると新たな出席以外の回答はできません。既存回答の変更や出席への変更はできます。</p> : null
}

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
