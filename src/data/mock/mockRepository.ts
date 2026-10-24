// メモリ上で動くモック実装。localStorage に保存するので、リロードしてもデータとログイン状態が残る。
// 権限チェックは Firestore セキュリティルールで行う予定の内容（docs/data-model.md）と揃えている。
// 別タブで変更すると storage イベントで反映されるので、リアルタイム更新の確認にも使える。

import { generateJoinCode, normalizeJoinCode } from '../../lib/joinCode'
import type {
  EquipmentItem,
  EventNote,
  Member,
  Team,
  TeamEvent,
  UserProfile,
} from '../../types'
import { RepositoryError, type Repository, type Unsubscribe } from '../repository'
import { createSeed } from './seed'

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
  users: Record<string, { displayName: string; teamId: string | null }>
  /** 参加コード → teamId */
  joinCodes: Record<string, string>
  teams: Record<string, StoredTeam>
}

const DB_KEY = 'bukatsu:mock-db:v1'
const SESSION_KEY = 'bukatsu:mock-session:v1'
/** 通信の遅延を再現する */
const LATENCY_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const newId = () => crypto.randomUUID()

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
      return JSON.parse(raw, reviveDates) as MockDb
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

  return {
    reset() {
      db = createSeed()
      commit()
      setSession(null)
    },

    auth: {
      onAuthStateChanged(cb) {
        const listener = (uid: string | null) => {
          const account = uid ? db.accounts[uid] : undefined
          cb(account ? { uid: account.uid, email: account.email } : null)
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
        db.users[uid] = { displayName: displayName.trim(), teamId: null }
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

      async signOut() {
        setSession(null)
      },

      async sendPasswordReset() {
        // モックでは送信したことにする
        await sleep(LATENCY_MS)
      },
    },

    users: {
      subscribeProfile(uid, cb) {
        return watch<UserProfile | null>(() => {
          const user = db.users[uid]
          return user ? { uid, ...user } : null
        }, cb)
      },

      async updateDisplayName(displayName) {
        await sleep(LATENCY_MS)
        const uid = requireUid()
        const name = displayName.trim()
        if (!name) throw new RepositoryError('名前を入力してください')
        const user = db.users[uid]
        user.displayName = name
        const team = user.teamId ? db.teams[user.teamId] : undefined
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
      async create(name) {
        await sleep(LATENCY_MS)
        const uid = requireUid()
        if (db.users[uid].teamId) throw new RepositoryError('すでにチームに参加しています')
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
          members: { [uid]: { uid, displayName: db.users[uid].displayName, role: 'admin', joinedAt: now } },
          events: {},
          equipment: {},
        }
        db.teams[teamId].joinCode = issueJoinCode(teamId)
        db.users[uid].teamId = teamId
        commit()
        return teamId
      },

      async join(code) {
        await sleep(LATENCY_MS)
        const uid = requireUid()
        if (db.users[uid].teamId) throw new RepositoryError('すでにチームに参加しています')
        const teamId = db.joinCodes[normalizeJoinCode(code)]
        if (!teamId) throw new RepositoryError('参加コードが正しくありません')
        db.teams[teamId].members[uid] = {
          uid,
          displayName: db.users[uid].displayName,
          role: 'member',
          joinedAt: new Date(),
        }
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

      async updateSettings(teamId, settings) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        team.settings = { ...team.settings, ...settings }
        commit()
      },

      async setRole(teamId, uid, role) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const target = team.members[uid]
        if (!target) throw new RepositoryError('メンバーが見つかりません')
        const admins = Object.values(team.members).filter((m) => m.role === 'admin')
        if (role === 'member' && target.role === 'admin' && admins.length <= 1) {
          throw new RepositoryError('管理者が0人になるため変更できません')
        }
        target.role = role
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

      async create(teamId, input) {
        await sleep(LATENCY_MS)
        const { uid, team } = requireEventEditor(teamId)
        const id = newId()
        team.events[id] = { id, ...input, attendance: {}, createdBy: uid, updatedAt: new Date(), notes: {} }
        commit()
        return id
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
        const id = newId()
        team.equipment[id] = { id, ...input, holderUid: null, holderName: null, updatedAt: new Date() }
        commit()
        return id
      },

      async update(teamId, itemId, input) {
        await sleep(LATENCY_MS)
        const { team } = requireMember(teamId)
        Object.assign(requireItem(team, itemId), input, { updatedAt: new Date() })
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

      async forceRelease(teamId, itemId) {
        await sleep(LATENCY_MS)
        const { team } = requireAdmin(teamId)
        const item = requireItem(team, itemId)
        Object.assign(item, { holderUid: null, holderName: null, updatedAt: new Date() })
        commit()
      },
    },
  }
}
