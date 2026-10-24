// ドメインの型。構造は docs/data-model.md に合わせる。

export type Role = 'admin' | 'member'

/** 'present'（出席）は保存しない。attendance にキーがない人は出席扱い */
export type AttendanceStatus = 'present' | 'absent' | 'observe' | 'late' | 'leave_early'
export type StoredAttendance = Exclude<AttendanceStatus, 'present'>

export type EventEditPolicy = 'admins' | 'all'

export interface EventType {
  id: string
  label: string
  color: string
}

export interface TeamSettings {
  eventEditPolicy: EventEditPolicy
  eventTypes: EventType[]
}

export interface Team {
  /** 削除開始後は通常操作を停止し、削除者が再開する */
  deleting?: boolean
  deletionUid?: string
  id: string
  name: string
  createdBy: string
  createdAt: Date
  settings: TeamSettings
}

export interface Member {
  uid: string
  displayName: string
  role: Role
  joinedAt: Date
}

export interface TeamEvent {
  deleting?: boolean
  id: string
  title: string
  typeId: string
  startAt: Date
  place: string | null
  attendance: Record<string, StoredAttendance>
  createdBy: string
  updatedAt: Date
}

export interface EventInput {
  title: string
  typeId: string
  startAt: Date
  place: string | null
}

export interface EventNote {
  id: string
  authorUid: string
  authorName: string
  body: string
  createdAt: Date
}

export interface EquipmentItem {
  id: string
  name: string
  holderUid: string | null
  holderName: string | null
  updatedAt: Date
}

export interface EquipmentInput {
  /** チーム内で重複不可（全角・半角、大文字・小文字、前後の空白は区別しない） */
  name: string
}

export interface AuthUser {
  uid: string
  email: string
  /** 登録したメールアドレスの持ち主であることを、確認メールのリンクで確認済みか（#39） */
  emailVerified: boolean
}

export interface UserProfile {
  uid: string
  displayName: string
  teamIds: string[]
  /** 現在選択中のチーム */
  teamId: string | null
}
