import type { AttendanceStatus, StoredAttendance } from '../types'

export const MAX_STORED_ATTENDANCE = 500
export const ATTENDANCE_LIMIT_MESSAGE = 'この予定の出席以外の回答は500件までです。既存の回答の変更や出席への変更はできます。管理者にご相談ください。'

export const ATTENDANCE_OPTIONS: { status: AttendanceStatus; label: string; color: string }[] = [
  { status: 'present', label: '出席', color: 'var(--att-present)' },
  { status: 'absent', label: '欠席', color: 'var(--att-absent)' },
  { status: 'observe', label: '見学', color: 'var(--att-observe)' },
  { status: 'late', label: '遅刻', color: 'var(--att-late)' },
  { status: 'leave_early', label: '早退', color: 'var(--att-leave-early)' },
]

/** キーがなければ出席 */
export function statusOf(attendance: Record<string, StoredAttendance>, uid: string): AttendanceStatus {
  return attendance[uid] ?? 'present'
}
