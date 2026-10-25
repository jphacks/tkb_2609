import { placesError } from '../../lib/places'
import { eventTypesError } from '../../lib/eventTypes'
// メモリ上で動くモック実装。localStorage に保存するので、リロードしてもデータとログイン状態が残る。
// 権限チェックは Firestore セキュリティルールで行う予定の内容（docs/data-model.md）と揃えている。
// 別タブで変更すると storage イベントで反映されるので、リアルタイム更新の確認にも使える。

import { equipmentNameError, isDuplicateEquipmentName } from '../../lib/equipment'
import { generateJoinCode, normalizeJoinCode } from '../../lib/joinCode'
import { MAX_WEEKLY_EVENTS } from '../../lib/weekly'
import type { EquipmentItem, EventNote, Member, Team, TeamEvent, UserProfile } from '../../types'
import { RepositoryError, type Repository, type Unsubscribe } from '../repository'
import { createSeed, MOCK_GOOGLE_ACCOUNT } from './seed'

export interface StoredEvent extends TeamEvent {
  notes: Record<string, EventNote>
}

interface StoredTeam extends Omit<Team, 'id'> {
  joinCode: string
  members: Record<string, Member>
  events: Record<string, StoredEvent>
  equipment: Record<string, EquipmentItem>
}

export interface MockDb {
  accounts: Record<string, { uid: string; email: string; password: string }>
  users: Record<string, Omit<UserProfile, 'uid'>>
  /** 参加コード → teamId */
  joinCodes: Record<string, string>
  teams: Record<string, StoredTeam>
}

const DB_KEY = 'bukatsu:mock-db:v2'
const SESSION_KEY = 'bukatsu:mock-session:v1'
/** 通信の遅延を再現する */
const LATENCY_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// 同じ Wi-Fi の HTTP プレビューでも動く（randomUUID は HTTPS 限定）。
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')

// 名前が "At" で終わる項目は日時として復元する
function reviveDates(key: string, value: unknown) {
  return key.endsWith('At') && typeof value === 'string' ? new Date(value) : value
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // プライベートブラウズなどで保存できなくても、メモリ上では動かす
  }
}

function loadDb(): MockDb {
  const raw = readStorage(DB_KEY)
  if (raw) {
    try {
      const db = JSON.parse(raw, reviveDates) as MockDb
      // v2 の単一所属データも、実際のメンバー情報から移行する。
      for (const [uid, user] of Object.entries(db.users)) {
        user.teamIds = Object.keys(db.teams).filter((id) => !!db.teams[id].members[uid])
        if (!user.teamId || !user.teamIds.includes(user.teamId)) user.teamId = user.teamIds[0] ?? null
      }
      return db
    } catch {
      // 壊れていたら初期データに戻す
    }
  }
  return createSeed()
}

export function createMockRepository(): Repository & { reset(): void } {
  let db = loadDb()
  let currentUid: string | null = readStorage(SESSION_KEY)
  if (currentUid && !db.accounts[currentUid]) currentUid = null

  const listeners = new Set<() => void>()
  const authListeners = new Set<(uid: string | null) => void>()

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function commit() {
    writeStorage(DB_KEY, JSON.stringify(db))
    notify()
  }

  window.addEventListener('storage', (e) => {
    if (e.key === DB_KEY) {
      db = loadDb()
      if (currentUid && !db.accounts[currentUid]) setSession(null)
      notify()
    }
  })

  /** onSnapshot 相当。初回と、変更のたびに select の結果を渡す */
  function watch<T>(select: () => T, cb: (value: T) => void): Unsubscribe {
    let active = true
    const run = () => {
      const value = structuredClone(select())
      setTimeout(() => active && cb(value), LATENCY_MS)
    }
    listeners.add(run)
    run()
    return () => {
      active = false
      listeners.delete(run)
    }
  }

  function setSession(uid: string | null) {
    currentUid = uid
    writeStorage(SESSION_KEY, uid)
    authListeners.forEach((listener) => listener(uid))
  }

  function requireUid(): string {
    if (!currentUid) throw new RepositoryError('ログインしてください')
    return currentUid
  }

  function requireTeam(teamId: string): StoredTeam {
    const team = db.teams[teamId]
    if (!team) throw new RepositoryError('チームが見つかりません')
    return team
  }

  function requireMember(teamId: string): { uid: string; team: StoredTeam; member: Member } {
    const uid = requireUid()
    const team = requireTeam(teamId)
    const member = team.members[uid]
    if (!member) throw new RepositoryError('このチームのメンバーではありません')
    return { uid, team, member }
  }

  function requireAdmin(teamId: string) {
    const ctx = requireMember(teamId)
    if (ctx.member.role !== 'admin') throw new RepositoryError('管理者のみ操作できます')
    return ctx
  }

  function requireEventEditor(teamId: string) {
    const ctx = requireMember(teamId)
    if (ctx.team.settings.eventEditPolicy === 'admins' && ctx.member.role !== 'admin') {
      throw new RepositoryError('予定を編集できるのは管理者のみです')
    }
    return ctx
  }

  function requireEvent(team: StoredTeam, eventId: string): StoredEvent {
    const event = team.events[eventId]
    if (!event) throw new RepositoryError('予定が見つかりません')
    return event
  }

  function requireItem(team: StoredTeam, itemId: string): EquipmentItem {
    const item = team.equipment[itemId]
    if (!item) throw new RepositoryError('用具が見つかりません')
    return item
  }

  function issueJoinCode(teamId: string): string {
    let code = generateJoinCode()
    while (db.joinCodes[code]) code = generateJoinCode()
    db.joinCodes[code] = teamId
    return code
  }

  function adminCount(team: StoredTeam): number {
    return Object.values(team.members).filter((m) => m.role === 'admin').length
  }

  /** チームから外す。持っていた用具は手放した状態にする */
  function detachMember(team: StoredTeam, uid: string) {
    for (const item of Object.values(team.equipment)) {
      if (item.holderUid === uid) Object.assign(item, { holderUid: null, holderName: null, updatedAt: new Date() })
    }
    delete team.members[uid]
    const user = db.users[uid]
    if (user) {
      user.teamIds = user.teamIds.filter((id) => db.teams[id] !== team)
      if (user.teamId && db.teams[user.teamId] === team) user.teamId = user.teamIds[0] ?? null
    }
  }

  function validEquipmentName(team: StoredTeam, name: string, exceptId?: string): string {
    const inputError = equipmentNameError(name)
    if (inputError) throw new RepositoryError(inputError)
    const trimmed = name.normalize('NFKC').trim()
    if (!trimmed) throw new RepositoryError('用具名を入力してください')
    if (isDuplicateEquipmentName(Object.values(team.equipment), trimmed, exceptId)) {
      throw new RepositoryError(`「${trimmed}」はすでに登録されています`)
    }
    return trimmed
  }

  return {
    supports: { multipleTeams: true, deleteTeam: true },
    reset() {
      db = createSeed()
      commit()
      setSession(null)
    },

    auth: {
      async cancelAccountDeletion() {
        db.users[requireUid()].deletingAccount = false
        commit()
      },
      async deleteAccount({ confirmation, password }) {
        const uid = requireUid(), account = db.accounts[uid]
        if (confirmation !== '削除') throw new RepositoryError('確認欄に「削除」と入力してください。')
        if (account.email !== MOCK_GOOGLE_ACCOUNT.email && password !== account.password) throw new RepositoryError('パスワードが正しくありません。')
        await sleep(LATENCY_MS)
        const teams = Object.values(db.teams).filter((t) => !!t.members[uid])
        if (teams.some((t) => t.members[uid].role === 'admin' && adminCount(t) <= 1)) throw new RepositoryError('最後の管理者になっているチームがあります。他の管理者を任命するか、チームを削除してからやり直してください。')
        teams.forEach((t) => detachMember(t, uid))
        delete db.users[uid]
        delete db.accounts[uid]
        setSession(null)
        commit()
      },
      onAuthStateChanged(cb) {
        const listener = (uid: string | null) => {
          const account = uid ? db.accounts[uid] : undefined
          // モックではメールを送れないため、すべて確認済みとして扱う
          cb(account ? { uid: account.uid, email: account.email, emailVerified: true, providers: [account.email === MOCK_GOOGLE_ACCOUNT.email ? 'google.com' : 'password'] } : null)
        }
        authListeners.add(listener)
        listener(currentUid)
        return () => authListeners.delete(listener)
      },

      async signUp({ email, password, displayName }) {
        await sleep(LATENCY_MS)
        const normalized = email.trim().toLowerCase()
        if (Object.values(db.accounts).some((a) => a.email === normalized)) {
          throw new RepositoryError('このメールアドレスはすでに登録されています')
        }
        const uid = newId()
        db.accounts[uid] = { uid, email: normalized, password }
        db.users[uid] = { displayName: displayName.trim(), teamIds: [], teamId: null }
        commit()
        setSession(uid)
      },

      async signIn(email, password) {
        await sleep(LATENCY_MS)
        const normalized = email.trim().toLowerCase()
        const account = Object.values(db.accounts).find((a) => a.email === normalized)
        if (!account || account.password !== password) {
          throw new RepositoryError('メールアドレスまたはパスワードが正しくありません')
        }
        setSession(account.uid)
      },

      async signInWithGoogle() {
        // モックでは Google の画面を出さず、Google アカウントでログインしたことにする（初回は登録も兼ねる）
        await sleep(LATENCY_MS)
        const email = MOCK_GOOGLE_ACCOUNT.email
        let account = Object.values(db.accounts).find((a) => a.email === email)
        if (!account) {
          const uid = newId()
          account = db.accounts[uid] = { uid, email, password: newId() }
          db.users[uid] = { displayName: MOCK_GOOGLE_ACCOUNT.displayName, teamIds: [], teamId: null }
          commit()
        }
        setSession(account.uid)
      },

      async signOut() {
        setSession(null)
      },

      async sendEmailVerification() {
        await sleep(LATENCY_MS)
      },

      async reloadUser() {
        setSession(currentUid)
      },

      async sendPasswordReset() {
        // モックでは送信したことにする
        await sleep(LATENCY_MS)
      },
    },

    users: {
      async updateAccountName(displayName) {
        const uid = requireUid(), name = displayName.trim()
        if (!name || name.length > 40) throw new RepositoryError('名前は1〜40文字で入力してください。')
        db.users[uid].displayName = name
        commit()
      },
      subscribeProfile(uid, cb) {
        return watch<UserProfile | null>(() => {
          const user = db.users[uid]
          return user ? { uid, ...user } : null
        }, cb)
      },

      async updateDisplayName(teamId, displayName) {
        await sleep(LATENCY_MS)
        const { uid, team } = requireMember(teamId)
        const name = displayName.trim()
        if (!name) throw new RepositoryError('名前を入力してください')
        // アカウント名と他チームの表示名には影響させない。
        if (team) {
          if (team.members[uid]) team.members[uid].displayName = name
          for (const item of Object.values(team.equipment)) {
            if (item.holderUid === uid) item.holderName = name
          }
        }
        commit()
      },
    },

    teams: {
      subscribeJoinCode(teamId, cb) {
        return watch(
          () => (db.teams[teamId]?.members[currentUid ?? '']?.role === 'admin' ? db.teams[teamId].joinCode : null),
          cb,
        )
      },
      async remove(teamId) {
        await sleep(LATENCY_MS)
        requireAdmin(teamId)
        // 選択中のチームは各ユーザーの残りの所属へ切り替える。
        for (const user of Object.values(db.users)) {
          user.teamIds = user.teamIds.filter((id) => id !== teamId)
          if (user.teamId === teamId) user.teamId = user.teamIds[0] ?? null
        }
        for (const [code, id] of Object.entries(db.joinCodes)) {
          if (id === teamId) delete db.joinCodes[code]
        }
        delete db.teams[teamId]
        commit()
      },
      subscribeMine(cb) {
        // ログアウト直後に通知が来ても例外で他の購読を止めないよう、requireUid は使わない
        return watch(() => {
          const uid = currentUid ?? ''
          return Object.entries(db.teams).filter(([, team]) => !!team.members[uid])
            .map(([id, { name, createdBy, createdAt, settings }]) => ({ id, name, createdBy, createdAt, settings }))
        }, cb)
      },
      async select(teamId) {
        const { uid } = requireMember(teamId)
        db.users[uid].teamId = teamId
        commit()
      },
      async create(name, displayName) {
        await sleep(LATENCY_MS)
        const uid = requireUid()
        if (!displayName.trim()) throw new RepositoryError('このチームでの名前を入力してください')
        if (!name.trim()) throw new RepositoryError('チーム名を入力してください')
        const teamId = newId()
        const now = new Date()
        db.teams[teamId] = {
          name: name.trim(),
          createdBy: uid,
          createdAt: now,
          settings: {
            eventEditPolicy: 'admins',
            eventTypes: [
              { id: 'practice', label: '練習', color: '#2563eb' },
              { id: 'match', label: '試合', color: '#e8590c' },
            ],
          },
          joinCode: '',
          members: { [uid]: { uid, displayName: displayName.trim(), role: 'admin', joinedAt: now } },
          events: {},
          equipment: {},
        }
        db.teams[teamId].joinCode = issueJoinCode(teamId)
        db.users[uid].teamIds.push(teamId)
        db.users[uid].teamId = teamId
        commit()
        return teamId
      },

      async join(code, displayName) {
        await sleep(LATENCY_MS)
        const uid = requireUid()
        if (!displayName.trim()) throw new RepositoryError('このチームでの名前を入力してください')
        const teamId = db.joinCodes[normalizeJoinCode(code)]
        if (!teamId) throw new RepositoryError('参加コードが正しくありません')
        if (db.teams[teamId].members[uid]) throw new RepositoryError('このチームにはすでに参加しています')
        db.teams[teamId].members[uid] = {
          uid,
          displayName: displayName.trim(),
          role: 'member',
          joinedAt: new Date(),
        }
        db.users[uid].teamIds.push(teamId)
        db.users[uid].teamId = teamId
        commit()
        return teamId
      },

      subscribe(teamId, cb) {
        return watch<Team | null>(() => {
          const team = db.teams[teamId]
          if (!team) return null
          const { name, createdBy, createdAt, settings } = team
          return { id: teamId, name, createdBy, createdAt, settings }
        }, cb)
      },

      subscribeMembers(teamId, cb) {
        return watch(() => Object.values(db.teams[teamId]?.members ?? {}), cb)
      },

      async rename(teamId, name) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const trimmed = name.trim()
        if (!trimmed) throw new RepositoryError('チーム名を入力してください')
        team.name = trimmed
        commit()
      },

      async updateSettings(teamId, settings) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const next = { ...team.settings, ...settings, ...(settings.places ? { places: settings.places.map((p) => p.trim()) } : {}) }
        const validation = eventTypesError(next.eventTypes) || placesError(next.places ?? [])
        if (validation) throw new RepositoryError(validation)
        team.settings = next
        commit()
      },

      async setRole(teamId, uid, role) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const target = team.members[uid]
        if (!target) throw new RepositoryError('メンバーが見つかりません')
        if (role === 'member' && target.role === 'admin' && adminCount(team) <= 1) {
          throw new RepositoryError('管理者が0人になるため変更できません')
        }
        target.role = role
        commit()
      },

      async leave(teamId) {
        await sleep(LATENCY_MS)
        const { uid, team, member } = requireMember(teamId)
        if (member.role === 'admin' && adminCount(team) <= 1) {
          throw new RepositoryError('最後の管理者は離れられません。他のメンバーを管理者にしてください')
        }
        detachMember(team, uid)
        commit()
      },

      async removeMember(teamId, uid) {
        await sleep(LATENCY_MS)
        const { uid: myUid, team } = requireAdmin(teamId)
        if (uid === myUid) throw new RepositoryError('自分を削除するときは「チームを離れる」を使ってください')
        const target = team.members[uid]
        if (!target) throw new RepositoryError('メンバーが見つかりません')
        if (target.role === 'admin' && adminCount(team) <= 1) {
          throw new RepositoryError('管理者が0人になるため削除できません')
        }
        detachMember(team, uid)
        commit()
      },

      async getJoinCode(teamId) {
        await sleep(LATENCY_MS)
        return requireAdmin(teamId).team.joinCode
      },

      async regenerateJoinCode(teamId) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        delete db.joinCodes[team.joinCode]
        team.joinCode = issueJoinCode(teamId)
        commit()
        return team.joinCode
      },
    },

    events: {
      subscribeUpcoming(teamId, cb) {
        return watch<TeamEvent[]>(() => {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          return Object.values(db.teams[teamId]?.events ?? {})
            .filter((e) => e.startAt >= today)
            .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
            .map(({ notes: _notes, ...event }) => event)
        }, cb)
      },

      async create(teamId, input, initialNote) {
        await sleep(LATENCY_MS)
        const { uid, team } = requireEventEditor(teamId)
        const id = newId()
        team.events[id] = { id, ...input, attendance: {}, createdBy: uid, updatedAt: new Date(), notes: {} }
        if (initialNote?.trim()) {
          const noteId = newId()
          team.events[id].notes[noteId] = {
            id: noteId,
            authorUid: uid,
            authorName: team.members[uid].displayName,
            body: initialNote.trim(),
            createdAt: new Date(),
          }
        }
        commit()
        return id
      },

      async createMany(teamId, inputs) {
        await sleep(LATENCY_MS)
        if (inputs.length === 0 || inputs.length > MAX_WEEKLY_EVENTS)
          throw new RepositoryError(`一度に追加できる予定は${MAX_WEEKLY_EVENTS}件までです`)
        const { uid, team } = requireEventEditor(teamId)
        const ids = inputs.map((input) => {
          const id = newId()
          team.events[id] = { id, ...input, attendance: {}, createdBy: uid, updatedAt: new Date(), notes: {} }
          return id
        })
        commit()
        return ids
      },

      async update(teamId, eventId, input) {
        await sleep(LATENCY_MS)
        const { team } = requireEventEditor(teamId)
        Object.assign(requireEvent(team, eventId), input, { updatedAt: new Date() })
        commit()
      },

      async remove(teamId, eventId) {
        await sleep(LATENCY_MS)
        const { team } = requireEventEditor(teamId)
        requireEvent(team, eventId)
        delete team.events[eventId]
        commit()
      },

      async setAttendance(teamId, eventId, status) {
        const { uid, team } = requireMember(teamId)
        const event = requireEvent(team, eventId)
        if (status === 'present') delete event.attendance[uid]
        else event.attendance[uid] = status
        commit()
      },

      subscribeNotes(teamId, eventId, cb) {
        return watch(
          () =>
            Object.values(db.teams[teamId]?.events[eventId]?.notes ?? {}).sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
            ),
          cb,
        )
      },

      async addNote(teamId, eventId, body) {
        await sleep(LATENCY_MS)
        const { uid, team, member } = requireMember(teamId)
        const text = body.trim()
        if (!text) throw new RepositoryError('メモを入力してください')
        const id = newId()
        requireEvent(team, eventId).notes[id] = {
          id,
          authorUid: uid,
          authorName: member.displayName,
          body: text,
          createdAt: new Date(),
        }
        commit()
      },

      async removeNote(teamId, eventId, noteId) {
        await sleep(LATENCY_MS)
        const { uid, team } = requireMember(teamId)
        const event = requireEvent(team, eventId)
        if (event.notes[noteId]?.authorUid !== uid) throw new RepositoryError('自分のメモのみ削除できます')
        delete event.notes[noteId]
        commit()
      },
    },

    equipment: {
      subscribe(teamId, cb) {
        return watch(() => Object.values(db.teams[teamId]?.equipment ?? {}), cb)
      },

      async add(teamId, input) {
        await sleep(LATENCY_MS)
        const { team } = requireMember(teamId)
        const name = validEquipmentName(team, input.name)
        const id = newId()
        team.equipment[id] = { id, name, holderUid: null, holderName: null, updatedAt: new Date() }
        commit()
        return id
      },

      async update(teamId, itemId, input) {
        await sleep(LATENCY_MS)
        const { team } = requireMember(teamId)
        const item = requireItem(team, itemId)
        Object.assign(item, { name: validEquipmentName(team, input.name, itemId), updatedAt: new Date() })
        commit()
      },

      async remove(teamId, itemId) {
        await sleep(LATENCY_MS)
        const { team } = requireMember(teamId)
        requireItem(team, itemId)
        delete team.equipment[itemId]
        commit()
      },

      async hold(teamId, itemId) {
        await sleep(LATENCY_MS)
        const { uid, team, member } = requireMember(teamId)
        const item = requireItem(team, itemId)
        if (item.holderUid) throw new RepositoryError(`${item.holderName ?? '他のメンバー'}さんがすでに持っています`)
        Object.assign(item, { holderUid: uid, holderName: member.displayName, updatedAt: new Date() })
        commit()
      },

      async release(teamId, itemId) {
        await sleep(LATENCY_MS)
        const { uid, team } = requireMember(teamId)
        const item = requireItem(team, itemId)
        if (item.holderUid !== uid) throw new RepositoryError('自分が持っている用具のみ手放せます')
        Object.assign(item, { holderUid: null, holderName: null, updatedAt: new Date() })
        commit()
      },

      async forceRelease(teamId, itemId, expectedHolderUid) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const item = requireItem(team, itemId)
        if (expectedHolderUid !== undefined && item.holderUid !== expectedHolderUid)
          throw new RepositoryError('持ち主が変わりました。最新の状態を確認してください。')
        Object.assign(item, { holderUid: null, holderName: null, updatedAt: new Date() })
        commit()
      },
    },
  }
}
