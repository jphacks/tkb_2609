// データの読み書きはすべてこのインターフェースを通す。
// モック段階ではメモリ上の実装（mock/）を使い、実装段階で Firestore 版に差し替える。
// subscribe 系は Firestore の onSnapshot と同じく、変更のたびにコールバックを呼ぶ。
// 「誰が操作したか」は Firebase Auth と同じく、ログイン中のユーザーを暗黙に使う。

import type {
  AttendanceStatus,
  AuthUser,
  EquipmentInput,
  EquipmentItem,
  EventInput,
  EventNote,
  Member,
  Role,
  Team,
  TeamEvent,
  TeamSettings,
  UserProfile,
} from '../types'

export type Unsubscribe = () => void

export interface Repository {
  /** Firestoreの購読失敗を画面へ通知する（モックでは不要） */
  onError?(cb: (error: RepositoryError) => void): Unsubscribe
  /** 実装ごとに対応している機能。未対応の機能は画面に出さない（現時点で両方ともモックのみ） */
  supports?: { multipleTeams?: boolean; deleteTeam?: boolean }
  auth: {
    onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe
    signUp(input: { email: string; password: string; displayName: string }): Promise<void>
    signIn(email: string, password: string): Promise<void>
    signOut(): Promise<void>
    sendPasswordReset(email: string): Promise<void>
  }
  users: {
    subscribeProfile(uid: string, cb: (profile: UserProfile | null) => void): Unsubscribe
    /** 対象チームの members の表示名と、自分が持っている用具の holderName を更新 */
    updateDisplayName(teamId: string, displayName: string): Promise<void>
  }
  teams: {
    /** 管理者のみ。チーム全体と参加コードを削除し、全員の所属から外す */
    remove(teamId: string): Promise<void>
    subscribeMine(cb: (teams: Team[]) => void): Unsubscribe
    select(teamId: string): Promise<void>
    /** チームを作り、作成者を管理者として登録する。戻り値は teamId */
    create(name: string, displayName: string): Promise<string>
    /** 参加コードでチームに参加する。戻り値は teamId */
    join(code: string, displayName: string): Promise<string>
    subscribe(teamId: string, cb: (team: Team | null) => void): Unsubscribe
    subscribeMembers(teamId: string, cb: (members: Member[]) => void): Unsubscribe
    /** 管理者のみ */
    rename(teamId: string, name: string): Promise<void>
    /** 管理者のみ */
    updateSettings(teamId: string, settings: Partial<TeamSettings>): Promise<void>
    /** 管理者のみ。管理者が0人になる変更はできない */
    setRole(teamId: string, uid: string, role: Role): Promise<void>
    /** 自分がチームを離れる。持っている用具は手放した状態になる。最後の管理者は離れられない */
    leave(teamId: string): Promise<void>
    /** 管理者のみ。メンバーの登録を削除する（引退・退部など）。持っている用具は手放した状態になる */
    removeMember(teamId: string, uid: string): Promise<void>
    /** 管理者のみ */
    getJoinCode(teamId: string): Promise<string>
    /** 管理者が表示中のコードのみ購読。再発行を他の端末へ反映する */
    subscribeJoinCode(teamId: string, cb: (code: string | null) => void): Unsubscribe
    /** 管理者のみ。古いコードは無効になる */
    regenerateJoinCode(teamId: string): Promise<string>
  }
  events: {
    /** 今日以降の予定を近い順に */
    subscribeUpcoming(teamId: string, cb: (events: TeamEvent[]) => void): Unsubscribe
    create(teamId: string, input: EventInput, initialNote?: string): Promise<string>
    update(teamId: string, eventId: string, input: EventInput): Promise<void>
    remove(teamId: string, eventId: string): Promise<void>
    /** 自分の出欠のみ。'present' を渡すとキーを削除する */
    setAttendance(teamId: string, eventId: string, status: AttendanceStatus): Promise<void>
    subscribeNotes(teamId: string, eventId: string, cb: (notes: EventNote[]) => void): Unsubscribe
    addNote(teamId: string, eventId: string, body: string): Promise<void>
    /** 自分のメモのみ */
    removeNote(teamId: string, eventId: string, noteId: string): Promise<void>
  }
  equipment: {
    subscribe(teamId: string, cb: (items: EquipmentItem[]) => void): Unsubscribe
    /** 同じ名前の用具がすでにあれば失敗する */
    add(teamId: string, input: EquipmentInput): Promise<string>
    /** 同じ名前の用具がすでにあれば失敗する */
    update(teamId: string, itemId: string, input: EquipmentInput): Promise<void>
    remove(teamId: string, itemId: string): Promise<void>
    /** 誰も持っていないときのみ。同時に押された場合は先の1人だけが成功する */
    hold(teamId: string, itemId: string): Promise<void>
    /** 自分が持っている用具を手放す */
    release(teamId: string, itemId: string): Promise<void>
    /** 管理者のみ。他人が持っている用具を手放させる */
    forceRelease(teamId: string, itemId: string, expectedHolderUid?: string): Promise<void>
  }
}

/** 利用者に見せてよいメッセージを持つエラー */
export class RepositoryError extends Error {}
