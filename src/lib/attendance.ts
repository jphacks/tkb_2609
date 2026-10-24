import type { AttendanceStatus, StoredAttendance } from '../types'

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
