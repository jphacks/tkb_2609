import type { AuthUser, EquipmentItem, EventNote, Member, Team, TeamEvent, UserProfile } from '../src/types'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp, FirebaseError, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  type Auth,
  type UserCredential,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { createFirestoreRepository } from '../src/data/firebase/firestoreRepository'
import type { Repository, Unsubscribe } from '../src/data/repository'
const projectId = 'demo-bukatsu'
let env: RulesTestEnvironment
const now = () => Timestamp.now()
const teamData = () => ({
  name: 'テストチーム',
  createdBy: 'admin',
  adminUid: 'admin',
  createdAt: now(),
  settings: { eventEditPolicy: 'admins', eventTypes: [{ id: 'practice', label: '練習', color: '#2563eb' }] },
})
const memberData = (role = 'member', displayName = 'メンバー') => ({
  displayName,
  role,
  joinedAt: now(),
  joinCode: 'K7MPX2QA',
  heldCount: 0,
  equipmentChangeId: '',
})
const eventData = () => ({
  title: '練習',
  typeId: 'practice',
  startAt: now(),
  place: null,
  attendance: {},
  createdBy: 'admin',
  updatedAt: serverTimestamp(),
})
// ルールのテストで使う利用者は、メールアドレス確認済みとする（#39）。未確認の場合は unverifiedDbFor を使う
const dbFor = (u: string) => env.authenticatedContext(u, { email_verified: true }).firestore() as unknown as Firestore
const unverifiedDbFor = (u: string) => env.authenticatedContext(u).firestore() as unknown as Firestore
const apps: FirebaseApp[] = []
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') },
  })
})
afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)))
  await env.cleanup()
})
// 前のテストの購読・修復トランザクションを残したままclearすると、
// エミュレータの初期化が500になる場合がある。各テストのクライアントを閉じる。
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
})
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    const b = writeBatch(db)
    b.set(doc(db, 'teams/t'), teamData())
    for (const [u, role] of [
      ['admin', 'admin'],
      ['member', 'member'],
      ['other', 'member'],
    ]) {
      b.set(doc(db, `teams/t/members/${u}`), memberData(role, u))
      b.set(doc(db, `users/${u}`), { displayName: u, teamId: 't' })
    }
    b.set(doc(db, 'users/new'), { displayName: 'new', teamId: null })
    b.set(doc(db, 'joinCodes/K7MPX2QA'), { teamId: 't', createdAt: now() })
    b.set(doc(db, 'teams/t/private/joinCode'), { code: 'K7MPX2QA' })
    b.set(doc(db, 'teams/t/events/e'), eventData())
    b.set(doc(db, 'teams/t/equipment/item'), {
      name: '用具',
      nameKey: '用具',
      holderUid: null,
      holderName: null,
      updatedAt: now(),
    })
    b.set(doc(db, 'teams/t/equipmentNames/用具'), { itemId: 'item' })
    await b.commit()
  })
})
describe('Firestore security rules', () => {
  // #39：登録したメールアドレスを確認するまで、チームのデータには触れない。自分のプロフィールは確認前でも扱える
  it('denies team data to users whose email is not verified, but allows their own profile', async () => {
    const db = unverifiedDbFor('member')
    await assertFails(getDoc(doc(db, 'teams/t')))
    await assertFails(getDocs(collection(db, 'teams/t/events')))
    await assertFails(getDoc(doc(db, 'joinCodes/K7MPX2QA')))
    await assertFails(updateDoc(doc(db, 'teams/t/events/e'), { 'attendance.member': 'late', updatedAt: serverTimestamp() }))
    await assertSucceeds(getDoc(doc(db, 'users/member')))
    const fresh = unverifiedDbFor('fresh')
    await assertSucceeds(setDoc(doc(fresh, 'users/fresh'), { displayName: '新規', teamId: null, teamIds: [] }))
    await assertSucceeds(updateDoc(doc(fresh, 'users/fresh'), { displayName: '新しい名前' }))
  })
  it('denies unauthenticated users and users outside the team', async () => {
    for (const db of [env.unauthenticatedContext().firestore() as unknown as Firestore, dbFor('outsider')]) {
      await assertFails(getDoc(doc(db, 'teams/t')))
      await assertFails(getDocs(collection(db, 'teams/t/events')))
      await assertFails(setDoc(doc(db, 'teams/t/events/bad'), eventData()))
    }
    await assertSucceeds(getDocs(collection(dbFor('member'), 'teams/t/events')))
  })
  it('allows one code lookup but never code listing or private code reads by members', async () => {
    await assertSucceeds(getDoc(doc(dbFor('new'), 'joinCodes/K7MPX2QA')))
    await assertFails(getDocs(collection(dbFor('admin'), 'joinCodes')))
    await assertFails(getDoc(doc(dbFor('member'), 'teams/t/private/joinCode')))
    await assertSucceeds(getDoc(doc(dbFor('admin'), 'teams/t/private/joinCode')))
  })
  it('requires a valid join code and atomic profile membership; forbids promotion on join', async () => {
    const db = dbFor('new')
    const join = (code: string, role: string) => {
      const b = writeBatch(db)
      b.set(doc(db, 'teams/t/members/new'), { ...memberData(role, 'new'), joinCode: code, joinedAt: serverTimestamp() })
      b.update(doc(db, 'users/new'), { teamId: 't' })
      return b.commit()
    }
    await assertFails(join('BADCODE2', 'member'))
    await assertFails(join('K7MPX2QA', 'admin'))
    await assertFails(
      setDoc(doc(db, 'teams/t/members/new'), { ...memberData('member', 'new'), joinedAt: serverTimestamp() }),
    )
    await assertSucceeds(join('K7MPX2QA', 'member'))
    await assertFails(updateDoc(doc(db, 'teams/t/members/new'), { role: 'admin' }))
  })
  it('validates team creation together with the creator, profile and private code', async () => {
    const db = dbFor('new'),
      b = writeBatch(db)
    b.set(doc(db, 'teams/new-team'), { ...teamData(), createdBy: 'new', adminUid: 'new', createdAt: serverTimestamp() })
    await assertFails(b.commit())
    const full = writeBatch(db)
    full.set(doc(db, 'teams/new-team'), {
      ...teamData(),
      createdBy: 'new',
      adminUid: 'new',
      createdAt: serverTimestamp(),
    })
    full.set(doc(db, 'teams/new-team/members/new'), {
      ...memberData('admin', 'new'),
      joinedAt: serverTimestamp(),
      joinCode: '',
    })
    full.set(doc(db, 'joinCodes/ABCD2345'), { teamId: 'new-team', createdAt: serverTimestamp() })
    full.set(doc(db, 'teams/new-team/private/joinCode'), { code: 'ABCD2345' })
    full.update(doc(db, 'users/new'), { teamId: 'new-team' })
    await assertSucceeds(full.commit())
  })
  it('enforces eventEditPolicy for create, update and delete', async () => {
    const db = dbFor('member')
    await assertFails(setDoc(doc(db, 'teams/t/events/new'), eventData()))
    await assertFails(updateDoc(doc(db, 'teams/t/events/e'), { title: '変更', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, 'teams/t/events/e')))
    await updateDoc(doc(dbFor('admin'), 'teams/t'), { 'settings.eventEditPolicy': 'all' })
    await assertSucceeds(setDoc(doc(db, 'teams/t/events/new'), { ...eventData(), createdBy: 'member' }))
    await assertSucceeds(updateDoc(doc(db, 'teams/t/events/e'), { title: '変更', updatedAt: serverTimestamp() }))
    await assertSucceeds(deleteDoc(doc(db, 'teams/t/events/e')))
  })
  it('permits own attendance only; presence must remove the key; editors cannot forge others', async () => {
    const db = dbFor('member'),
      ref = doc(db, 'teams/t/events/e')
    await assertSucceeds(updateDoc(ref, { 'attendance.member': 'late', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { 'attendance.other': 'absent', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { 'attendance.member': 'present', updatedAt: serverTimestamp() }))
    await assertFails(
      updateDoc(doc(dbFor('admin'), 'teams/t/events/e'), {
        'attendance.other': 'late',
        title: '偽装',
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(updateDoc(ref, { 'attendance.member': 'invalid', updatedAt: serverTimestamp() }))
  })
  it('validates author UID/name; notes cannot be edited or deleted by other users', async () => {
    const db = dbFor('member'),
      n = doc(db, 'teams/t/events/e/notes/n')
    const input = { authorUid: 'member', authorName: 'member', body: '連絡', createdAt: serverTimestamp() }
    await assertFails(setDoc(n, { ...input, authorUid: 'other' }))
    await assertFails(setDoc(n, { ...input, authorName: '偽装' }))
    await assertSucceeds(setDoc(n, input))
    await assertFails(updateDoc(n, { body: '更新' }))
    await assertFails(deleteDoc(doc(dbFor('admin'), 'teams/t/events/e/notes/n')))
    await assertSucceeds(deleteDoc(n))
  })
  it('requires possession and the counter to change together; denies theft and unauthorized forced release', async () => {
    const db = dbFor('member'),
      ref = doc(db, 'teams/t/equipment/item'),
      m = doc(db, 'teams/t/members/member')
    await assertFails(updateDoc(ref, { holderUid: 'member', holderName: 'member', updatedAt: serverTimestamp() }))
    const b = writeBatch(db)
    b.update(ref, { holderUid: 'member', holderName: 'member', updatedAt: serverTimestamp() })
    b.update(m, { heldCount: 1, equipmentChangeId: 'item' })
    await assertSucceeds(b.commit())
    await assertFails(updateDoc(m, { heldCount: 0 }))
    const other = dbFor('other'),
      steal = writeBatch(other)
    steal.update(doc(other, 'teams/t/equipment/item'), {
      holderUid: 'other',
      holderName: 'other',
      updatedAt: serverTimestamp(),
    })
    await assertFails(steal.commit())
    const forced = writeBatch(other)
    forced.update(doc(other, 'teams/t/equipment/item'), {
      holderUid: null,
      holderName: null,
      updatedAt: serverTimestamp(),
    })
    forced.update(doc(other, 'teams/t/members/member'), { heldCount: 0, equipmentChangeId: 'item' })
    await assertFails(forced.commit())
    const admin = dbFor('admin'),
      valid = writeBatch(admin)
    valid.update(doc(admin, 'teams/t/equipment/item'), {
      holderUid: null,
      holderName: null,
      updatedAt: serverTimestamp(),
    })
    valid.update(doc(admin, 'teams/t/members/member'), { heldCount: 0, equipmentChangeId: 'item' })
    await assertSucceeds(valid.commit())
  })
  it('prevents last-admin demotion and deletion, including direct SDK bypass', async () => {
    const db = dbFor('admin')
    await assertFails(updateDoc(doc(db, 'teams/t/members/admin'), { role: 'member' }))
    const b = writeBatch(db)
    b.delete(doc(db, 'teams/t/members/admin'))
    b.update(doc(db, 'users/admin'), { teamId: null })
    await assertFails(b.commit())
    await assertFails(updateDoc(doc(db, 'teams/t'), { adminUid: 'member' }))
    await updateDoc(doc(db, 'teams/t/members/member'), { role: 'admin' })
    const valid = writeBatch(db)
    valid.update(doc(db, 'teams/t'), { adminUid: 'member' })
    valid.update(doc(db, 'teams/t/members/admin'), { role: 'member' })
    await assertSucceeds(valid.commit())
  })
  it('prevents cross-team profiles, arbitrary schema fields and name-index overwrites', async () => {
    const db = dbFor('member')
    await assertFails(updateDoc(doc(db, 'users/member'), { teamId: 'other-team' }))
    await assertFails(updateDoc(doc(db, 'teams/t/events/e'), { unexpected: true, updatedAt: serverTimestamp() }))
    await assertFails(
      setDoc(doc(db, 'teams/t/equipment/dup'), {
        name: '用具',
        nameKey: '用具',
        holderUid: null,
        holderName: null,
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(setDoc(doc(db, 'teams/t/equipmentNames/用具'), { itemId: 'dup' }))
  })
})
function waitFor<T>(
  subscribe: (cb: (v: T) => void) => Unsubscribe,
  accept: (v: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let off: Unsubscribe = () => {}
    const timer = setTimeout(() => {
      off()
      reject(new Error('subscription timed out'))
    }, 8000)
    off = subscribe((v) => {
      if (accept(v)) {
        clearTimeout(timer)
        off()
        resolve(v)
      }
    })
  })
}
function emulatorApp() {
  const app = initializeApp({ projectId, apiKey: 'fake-api-key', appId: 'fake-app-id' }, randomUUID())
  apps.push(app)
  const auth = getAuth(app),
    db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { auth, db }
}
async function client(verify = true): Promise<Repository> {
  const { auth, db } = emulatorApp()
  const r = createFirestoreRepository(auth, db)
  await r.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: 'Example123!', displayName: 'テスト' })
  if (verify) {
    await markEmailVerified(auth.currentUser!.uid)
    await r.auth.reloadUser()
  }
  return r
}
/** Auth エミュレータの管理 API で、メールアドレスを確認済みにする（確認メールのリンクを開いたことの代わり） */
async function markEmailVerified(localId: string) {
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId, emailVerified: true }),
  })
  if (!res.ok) throw new Error(`failed to verify email: ${res.status}`)
}
describe('Firestore repository against Auth + Firestore emulators', () => {
  it('sends a verification email on sign-up and blocks team creation until the email is verified (#39)', async () => {
    const r = await client(false)
    const me = (await waitFor<AuthUser | null>((cb) => r.auth.onAuthStateChanged(cb), (u) => !!u))!
    expect(me.emailVerified).toBe(false)
    const codes = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`)).json()
    expect(codes.oobCodes.some((c: { email: string; requestType: string }) => c.email === me.email && c.requestType === 'VERIFY_EMAIL')).toBe(true)
    await expect(r.teams.create('未確認のチーム', '名前')).rejects.toThrow()
    await markEmailVerified(me.uid)
    await r.auth.reloadUser()
    expect((await waitFor<AuthUser | null>((cb) => r.auth.onAuthStateChanged(cb), (u) => !!u?.emailVerified))?.emailVerified).toBe(true)
    await expect(r.teams.create('確認後のチーム', '名前')).resolves.toBeTypeOf('string')
  })
  it('creates and joins teams, scopes data, rotates codes and persists membership on sign-in', async () => {
    const a = await client(),
      b = await client(),
      t = await a.teams.create('新しいチーム', 'テスト')
    const code = await a.teams.getJoinCode(t)
    expect(await b.teams.join(code.toLowerCase(), 'テスト')).toBe(t)
    expect((await waitFor<Team | null>((cb) => b.teams.subscribe(t, cb)))?.name).toBe('新しいチーム')
    await expect(b.teams.rename(t, '無権限')).rejects.toThrow()
    const next = await a.teams.regenerateJoinCode(t)
    const c = await client()
    await expect(c.teams.join(code, 'テスト')).rejects.toThrow()
    expect(await c.teams.join(next, 'テスト')).toBe(t)
    await a.teams.rename(t, '更新済み')
    const renamed = await waitFor<Team | null>(
      (cb) => b.teams.subscribe(t, cb),
      (team) => team?.name === '更新済み',
    )
    expect(renamed?.name).toBe('更新済み')
    const second = await client(),
      other = await second.teams.create('別チーム', 'テスト')
    expect(await waitFor<TeamEvent[]>((cb) => second.events.subscribeUpcoming(other, cb))).toEqual([])
  })
  it('bounds upcoming reads and keeps out-of-window events available by ID (#103)', async () => {
    const a = await client(), t = await a.teams.create('ページ確認', '管理者')
    const ids = await a.events.createMany(t, Array.from({ length: 42 }, (_, i) => ({
      title: `予定${i}`, typeId: 'practice', startAt: new Date(Date.now() + 86400000 + i * 60000), place: null,
    })))
    const first = await waitFor<{ rows: TeamEvent[]; more: boolean }>((cb) => a.events.subscribeUpcoming(t, (rows, more) => cb({ rows, more })))
    expect(first.rows.map((e) => e.id)).toEqual(ids.slice(0, 20)); expect(first.more).toBe(true)
    const expanded = await waitFor<{ rows: TeamEvent[]; more: boolean }>((cb) => a.events.subscribeUpcoming(t, (rows, more) => cb({ rows, more }), 60))
    expect(expanded.rows.map((e) => e.id)).toEqual(ids); expect(expanded.more).toBe(false)
    const moved = new Date(Date.now() + 100 * 86400000)
    await a.events.update(t, ids[0], { title: '移動済み', typeId: 'practice', startAt: moved, place: null })
    const selected = await waitFor<TeamEvent | null>((cb) => a.events.subscribeOne(t, ids[0], cb), (e) => e?.title === '移動済み')
    expect(selected?.startAt.getTime()).toBe(moved.getTime())
    expect((await waitFor<TeamEvent[]>((cb) => a.events.subscribeUpcoming(t, cb))).some((e) => e.id === ids[0])).toBe(false)
    const past = new Date(Date.now() - 86400000)
    await a.events.update(t, ids[0], { title: '過去へ移動', typeId: 'practice', startAt: past, place: null })
    expect((await waitFor<TeamEvent | null>((cb) => a.events.subscribeOne(t, ids[0], cb), (e) => e?.startAt.getTime() === past.getTime()))?.id).toBe(ids[0])
  })
  it('stops deletion at a bounded budget and resumes with a fresh repository (#104)', async () => {
    const a = await client(), t = await a.teams.create('停止確認', '管理者')
    const other = await a.teams.create('保持確認', '管理者')
    const e = await a.events.create(t, { title: '予定', typeId: 'practice', startAt: new Date(Date.now() + 86400000), place: null })
    for (let i = 0; i < 5; i++) await a.events.addNote(t, e, `メモ${i}`)
    expect((await a.teams.estimateDeletion(t)).minimumDocuments).toBe(3)
    const updates: { deleted: number; running: boolean }[] = []
    const off = a.teams.subscribeDeletionProgress(t, (p) => { if (p) updates.push(p) })
    await expect(a.teams.remove(t, { maxDeletes: 2 })).rejects.toThrow('今回の削除上限')
    expect(updates.at(-1)).toMatchObject({ deleted: 2, running: false })
    expect((await waitFor<EventNote[]>((cb) => a.events.subscribeNotes(t, e, cb), (rows) => rows.length === 3)).length).toBe(3)
    const app = apps.at(-1)!, resumed = createFirestoreRepository(getAuth(app), getFirestore(app))
    await resumed.teams.select(other)
    expect((await waitFor<Team | null>((cb) => resumed.teams.subscribe(other, cb)))?.name).toBe('保持確認')
    await resumed.teams.remove(t)
    expect((await waitFor<Team[]>((cb) => resumed.teams.subscribeMine(cb))).map((team) => team.id)).toEqual([other])
    off()
  })
  it('enforces the 500 answer cap atomically while allowing existing answers and present (#105)', async () => {
    const a = await client(), t = await a.teams.create('回答境界', '管理者'), b = await client(), c = await client()
    const code = await a.teams.getJoinCode(t)
    await b.teams.join(code, 'B'); await c.teams.join(code, 'C')
    const actor = (await waitFor<AuthUser | null>((cb) => a.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    const e = await a.events.create(t, { title: '予定', typeId: 'practice', startAt: new Date(Date.now() + 86400000), place: null })
    const attendance = { ...Object.fromEntries(Array.from({ length: 499 }, (_, i) => [(String(i) + 'x'.repeat(128)).slice(0, 128), 'absent'])), [actor]: 'absent' }
    expect(Buffer.byteLength(JSON.stringify(attendance))).toBeLessThan(300000)
    await env.withSecurityRulesDisabled(async (ctx) => updateDoc(doc(ctx.firestore() as unknown as Firestore, 'teams', t, 'events', e), { attendance }))
    await expect(a.events.setAttendance(t, e, 'late')).resolves.toBeUndefined()
    await expect(b.events.setAttendance(t, e, 'absent')).rejects.toThrow('500件まで')
    await a.events.setAttendance(t, e, 'present')
    const results = await Promise.allSettled([b.events.setAttendance(t, e, 'absent'), c.events.setAttendance(t, e, 'late')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    // アプリを通さない書き込みでも501件目と他人の回答変更を拒否する。
    const outsider = dbFor('member')
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, 'teams', t, 'members', 'member'), memberData()))
    await assertFails(updateDoc(doc(outsider, 'teams', t, 'events', e), { 'attendance.member': 'absent', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(outsider, 'teams', t, 'events', e), { [`attendance.${actor}`]: 'late', updatedAt: serverTimestamp() }))
  })
  it('queries today onward in order; writes attendance per UID and initial notes atomically', async () => {
    const a = await client(),
      t = await a.teams.create('予定チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const later = new Date(tomorrow)
    later.setDate(later.getDate() + 1)
    const past = new Date()
    past.setDate(past.getDate() - 1)
    const input = (startAt: Date) => ({ title: '練習', typeId: 'practice', startAt, place: '広場' })
    await a.events.create(t, input(past))
    const laterId = await a.events.create(t, input(later))
    const first = await a.events.create(t, input(tomorrow), '最初のメモ')
    const events = await waitFor<TeamEvent[]>(
      (cb) => a.events.subscribeUpcoming(t, cb),
      (e) => e.length === 2,
    )
    expect(events.map((e) => e.id)).toEqual([first, laterId])
    expect(events[0].startAt).toBeInstanceOf(Date)
    expect((await waitFor<EventNote[]>((cb) => a.events.subscribeNotes(t, first, cb)))[0].body).toBe('最初のメモ')
    await expect(b.events.update(t, first, input(tomorrow))).rejects.toThrow()
    await Promise.all([a.events.setAttendance(t, first, 'late'), b.events.setAttendance(t, first, 'absent')])
    let result = await waitFor<TeamEvent[]>(
      (cb) => a.events.subscribeUpcoming(t, cb),
      (e) => Object.keys(e[0]?.attendance || {}).length === 2,
    )
    expect(Object.values(result[0].attendance).sort()).toEqual(['absent', 'late'])
    await b.events.setAttendance(t, first, 'present')
    result = await waitFor<TeamEvent[]>(
      (cb) => a.events.subscribeUpcoming(t, cb),
      (e) => Object.keys(e[0]?.attendance || {}).length === 1,
    )
    expect(Object.values(result[0].attendance)).toEqual(['late'])
    await a.teams.updateSettings(t, { eventEditPolicy: 'all' })
    await b.events.update(t, first, { ...input(tomorrow), title: '全員編集' })
    const notes = await waitFor<EventNote[]>((cb) => b.events.subscribeNotes(t, first, cb))
    await expect(b.events.removeNote(t, first, notes[0].id)).rejects.toThrow()
    await b.events.addNote(t, first, 'メンバーのメモ')
    await a.events.remove(t, first)
    expect(
      (
        await waitFor<TeamEvent[]>(
          (cb) => a.events.subscribeUpcoming(t, cb),
          (e) => e.length === 1,
        )
      )[0].id,
    ).toBe(laterId)
  })
  it('allows only one concurrent holder; updates name copies and detaches safely', async () => {
    const a = await client(),
      t = await a.teams.create('用具チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const item = await a.equipment.add(t, { name: 'タイマー' })
    await expect(b.equipment.add(t, { name: ' ﾀｲﾏｰ ' })).rejects.toThrow()
    const holds = await Promise.allSettled([a.equipment.hold(t, item), b.equipment.hold(t, item)])
    expect(holds.filter((h) => h.status === 'fulfilled')).toHaveLength(1)
    await a.equipment.forceRelease(t, item)
    await b.equipment.hold(t, item)
    await b.users.updateDisplayName(t, '新しい表示名')
    expect(
      (
        await waitFor<EquipmentItem[]>(
          (cb) => a.equipment.subscribe(t, cb),
          (items) => items[0]?.holderName === '新しい表示名',
        )
      )[0].holderName,
    ).toBe('新しい表示名')
    await b.teams.leave(t)
    expect(
      (
        await waitFor<EquipmentItem[]>(
          (cb) => a.equipment.subscribe(t, cb),
          (items) => items[0]?.holderUid === null,
        )
      )[0].holderUid,
    ).toBeNull()
    await expect(a.teams.leave(t)).rejects.toThrow()
    await a.equipment.hold(t, item)
    await a.equipment.remove(t, item)
    expect(
      await waitFor<EquipmentItem[]>(
        (cb) => a.equipment.subscribe(t, cb),
        (e) => e.length === 0,
      ),
    ).toEqual([])
  })
})

describe('additional consistency guarantees', () => {
  it('cannot leave while holding equipment, bypassing the repository', async () => {
    const db = dbFor('member')
    const hold = writeBatch(db)
    hold.update(doc(db, 'teams/t/equipment/item'), {
      holderUid: 'member',
      holderName: 'member',
      updatedAt: serverTimestamp(),
    })
    hold.update(doc(db, 'teams/t/members/member'), { heldCount: 1, equipmentChangeId: 'item' })
    await hold.commit()
    const leave = writeBatch(db)
    leave.delete(doc(db, 'teams/t/members/member'))
    leave.update(doc(db, 'users/member'), { teamId: null })
    await assertFails(leave.commit())
  })
  it('validates nested event type objects and rejects unauthenticated code reads', async () => {
    await assertFails(updateDoc(doc(dbFor('admin'), 'teams/t'), { 'settings.eventTypes': ['broken'] }))
    await assertFails(
      updateDoc(doc(dbFor('admin'), 'teams/t'), {
        'settings.eventTypes': [{ id: 'x', label: '名前', color: 'url(bad)' }],
      }),
    )
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore
    await assertFails(getDoc(doc(db, 'joinCodes/K7MPX2QA')))
  })
  it('keeps at least one admin when another admin is removed', async () => {
    const a = await client(),
      t = await a.teams.create('権限チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const me = await waitFor<AuthUser | null>(
      (cb) => a.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    const member = await waitFor<AuthUser | null>(
      (cb) => b.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    await a.teams.setRole(t, member!.uid, 'admin')
    await a.teams.setRole(t, me!.uid, 'member')
    await expect(a.teams.rename(t, '変更不可')).rejects.toThrow()
    await b.teams.removeMember(t, me!.uid)
    const profile = await waitFor<UserProfile | null>(
      (cb) => a.users.subscribeProfile(me!.uid, cb),
      (p) => p?.teamId === null,
    )
    expect(profile?.teamId).toBeNull()
    await expect(b.teams.leave(t)).rejects.toThrow()
  })
  it('retains profile/team on repeat sign-in without requiring another join code', async () => {
    const r = await client(),
      t = await r.teams.create('再ログインチーム', 'テスト')
    const user = await waitFor<AuthUser | null>(
      (cb) => r.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    await r.auth.signOut()
    await r.auth.signIn(user!.email, 'Example123!')
    expect(
      (
        await waitFor<UserProfile | null>(
          (cb) => r.users.subscribeProfile(user!.uid, cb),
          (p) => p?.teamId === t,
        )
      )?.teamId,
    ).toBe(t)
  })
  it('creates up to 52 weekly events in one batch and enforces the edit policy (#44)', async () => {
    const a = await client(),
      t = await a.teams.create('毎週チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const start = new Date()
    start.setDate(start.getDate() + 1)
    const inputs = Array.from({ length: 52 }, (_, i) => {
      const startAt = new Date(start)
      startAt.setDate(startAt.getDate() + 7 * i)
      return { title: '毎週の練習', typeId: 'practice', startAt, place: '体育館' }
    })
    const ids = await a.events.createMany(t, inputs)
    expect(ids).toHaveLength(52)
    const events = await waitFor<TeamEvent[]>(
      (cb) => a.events.subscribeUpcoming(t, cb, 52),
      (e) => e.length === 52,
    )
    expect(events.map((e) => e.id)).toEqual(ids)
    expect(events.every((e) => e.title === '毎週の練習' && e.place === '体育館')).toBe(true)
    await expect(a.events.createMany(t, [...inputs, inputs[0]])).rejects.toThrow('52件まで')
    await expect(a.events.createMany(t, [])).rejects.toThrow()
    await expect(b.events.createMany(t, inputs.slice(0, 2))).rejects.toThrow()
    await a.teams.updateSettings(t, { eventEditPolicy: 'all' })
    expect(await b.events.createMany(t, inputs.slice(0, 2))).toHaveLength(2)
  })
  it('cleans up more than one batch of notes and can retry deletion', async () => {
    const r = await client(),
      t = await r.teams.create('大量メモチーム', 'テスト')
    const e = await r.events.create(t, { title: '予定', typeId: 'practice', startAt: new Date(), place: null })
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore,
        batch = writeBatch(db)
      for (let n = 0; n < 451; n++)
        batch.set(doc(db, `teams/${t}/events/${e}/notes/n${n}`), {
          authorUid: 'other',
          authorName: 'other',
          body: 'メモ',
          createdAt: now(),
        })
      await batch.commit()
    })
    await r.events.remove(t, e)
    await r.events.remove(t, e)
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      expect((await getDocs(collection(db, `teams/${t}/events/${e}/notes`))).size).toBe(0)
    })
  })
})

describe('concurrent changes and subscription errors', () => {
  it('never demotes both admins in competing requests', async () => {
    const a = await client(),
      t = await a.teams.create('並行権限チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const ua = await waitFor<AuthUser | null>(
      (cb) => a.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    const ub = await waitFor<AuthUser | null>(
      (cb) => b.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    await a.teams.setRole(t, ub!.uid, 'admin')
    const results = await Promise.allSettled([
      a.teams.setRole(t, ua!.uid, 'member'),
      b.teams.setRole(t, ub!.uid, 'member'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const members = await waitFor<Member[]>(
      (cb) => a.teams.subscribeMembers(t, cb),
      (m) => m.filter((x) => x.role === 'admin').length === 1,
    )
    expect(members.filter((m) => m.role === 'admin')).toHaveLength(1)
  })
  it('deletes equipment held by another member without corrupting the possession counter', async () => {
    const a = await client(),
      t = await a.teams.create('削除チーム', 'テスト'),
      b = await client()
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const item = await a.equipment.add(t, { name: 'ケース' })
    await a.equipment.hold(t, item)
    await b.equipment.remove(t, item)
    expect(
      await waitFor<EquipmentItem[]>(
        (cb) => a.equipment.subscribe(t, cb),
        (items) => items.length === 0,
      ),
    ).toEqual([])
    const ua = await waitFor<AuthUser | null>(
      (cb) => a.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      expect((await getDoc(doc(db, `teams/${t}/members/${ua!.uid}`))).data()?.heldCount).toBe(0)
    })
  })
  it('reports subscription permission errors instead of waiting forever', async () => {
    const outsider = await client(),
      errors: string[] = []
    const off = outsider.onError!((e) => errors.push(e.message))
    const events = await waitFor<TeamEvent[]>((cb) => outsider.events.subscribeUpcoming('t', cb))
    expect(events).toEqual([])
    expect(errors).toHaveLength(1)
    off()
  })
})

describe('equipment/settings realtime integration (#9–#11)', () => {
  it('delivers member and holder name updates to a listener on another client', async () => {
    const a = await client(),
      b = await client(),
      t = await a.teams.create('更新チーム', 'テスト')
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const item = await a.equipment.add(t, { name: 'ケース' })
    const held = waitFor<EquipmentItem[]>(
      (cb) => a.equipment.subscribe(t, cb),
      (items) => items.some((i) => i.id === item && i.holderUid !== null),
    )
    await b.equipment.hold(t, item)
    await held
    const changedMember = waitFor<Member[]>(
      (cb) => a.teams.subscribeMembers(t, cb),
      (ms) => ms.some((m) => m.displayName === '新しい名前'),
    )
    const changedItem = waitFor<EquipmentItem[]>(
      (cb) => a.equipment.subscribe(t, cb),
      (items) => items[0]?.holderName === '新しい名前',
    )
    await b.users.updateDisplayName(t, '新しい名前')
    await Promise.all([changedMember, changedItem])
    await a.equipment.update(t, item, { name: '収納ケース' })
    await expect(b.equipment.add(t, { name: '収納ｹｰｽ' })).rejects.toThrow()
    await expect(b.equipment.add(t, { name: '/不可' })).rejects.toThrow()
    // Renaming frees the previous name reservation.
    expect(await b.equipment.add(t, { name: 'ケース' })).toBeTruthy()
  })
  it('refuses forced release if the owner changed after confirmation opened', async () => {
    const a = await client(),
      b = await client(),
      t = await a.teams.create('確認チーム', 'テスト')
    await b.teams.join(await a.teams.getJoinCode(t), 'テスト')
    const item = await a.equipment.add(t, { name: 'タイマー' })
    const ub = await waitFor<AuthUser | null>(
      (cb) => b.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    await b.equipment.hold(t, item)
    await b.equipment.release(t, item)
    await a.equipment.hold(t, item)
    await expect(a.equipment.forceRelease(t, item, ub!.uid)).rejects.toThrow('持ち主が変わりました')
    const state = await waitFor<EquipmentItem[]>((cb) => a.equipment.subscribe(t, cb))
    expect(state[0].holderUid).not.toBeNull()
  })
  it('propagates private code regeneration between admins but denies member subscription', async () => {
    const a = await client(),
      b = await client(),
      t = await a.teams.create('招待チーム', 'テスト')
    const old = await a.teams.getJoinCode(t)
    await b.teams.join(old, 'テスト')
    const ub = await waitFor<AuthUser | null>(
      (cb) => b.auth.onAuthStateChanged(cb),
      (u) => u !== null,
    )
    const errors: string[] = [],
      stopErrors = b.onError!((e) => errors.push(e.message))
    expect(await waitFor<string | null>((cb) => b.teams.subscribeJoinCode(t, cb))).toBeNull()
    // 管理者でなくなった直後にも起きる想定内の拒否のため、エラーとして通知しない（#43）
    expect(errors).toHaveLength(0)
    stopErrors()
    await a.teams.setRole(t, ub!.uid, 'admin')
    const codeChanged = waitFor<string | null>(
      (cb) => b.teams.subscribeJoinCode(t, cb),
      (code) => code !== null && code !== old,
    )
    const next = await a.teams.regenerateJoinCode(t)
    expect(await codeChanged).toBe(next)
    await expect(
      a.teams.updateSettings(t, {
        eventTypes: Array.from({ length: 11 }, (_, i) => ({ id: String(i), label: '種類', color: '#2563eb' })),
      }),
    ).rejects.toThrow()
  })
})

describe('display name concurrency (#10)', () => {
  it('keeps holderName consistent when taking equipment races with changing the display name', async () => {
    const a = await client(),
      t = await a.teams.create('名前更新チーム', 'テスト')
    const first = await a.equipment.add(t, { name: 'ケース' }),
      second = await a.equipment.add(t, { name: 'タイマー' })
    await a.equipment.hold(t, first)
    await Promise.all([a.users.updateDisplayName(t, '更新後の名前'), a.equipment.hold(t, second)])
    const items = await waitFor<EquipmentItem[]>(
      (cb) => a.equipment.subscribe(t, cb),
      (list) => list.length === 2 && list.every((i) => i.holderName === '更新後の名前'),
    )
    expect(items.every((i) => i.holderName === '更新後の名前')).toBe(true)
  })
})

describe('Firebase multiple-team membership (#24)', () => {
  it('keeps account and team names separate, switches teams and detaches only one membership', async () => {
    const a = await client(), b = await client()
    const ub = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!
    const t = await a.teams.create('第一チーム', '管理者の名前')
    await b.teams.join(await a.teams.getJoinCode(t), '第一の名前')
    const other = await b.teams.create('第二チーム', '第二の名前')
    expect(b.supports).toEqual({multipleTeams: true, deleteTeam: true})
    const mine = await waitFor<Team[]>((cb) => b.teams.subscribeMine(cb), (ts) => ts.length === 2)
    expect(mine.map((team) => team.id).sort()).toEqual([t, other].sort())
    await b.teams.select(t)
    await expect(b.teams.select('outsider')).rejects.toThrow()
    await expect(b.teams.join(await a.teams.getJoinCode(t), '上書き')).rejects.toThrow()
    await b.users.updateDisplayName(t, '第一のみ変更')
    let profile = await waitFor<UserProfile | null>((cb) => b.users.subscribeProfile(ub.uid, cb), (p) => p?.teamId === t)
    expect(profile).toMatchObject({teamIds: [t, other], teamId: t, displayName: 'テスト'})
    expect((await waitFor<Member[]>((cb) => b.teams.subscribeMembers(other, cb)))[0].displayName).toBe('第二の名前')
    await a.teams.removeMember(t, ub.uid)
    profile = await waitFor<UserProfile | null>((cb) => b.users.subscribeProfile(ub.uid, cb), (p) => p?.teamId === other)
    expect(profile?.teamIds).toEqual([other])
  })
  // 表示するチームの切り替えは、サーバーの応答を待たずにプロフィールの購読へ反映する（切り替えが画面に出ない不具合の修正）
  it('reflects the team switch in the profile listener without waiting for the server', async () => {
    const { auth, db } = emulatorApp()
    const r = createFirestoreRepository(auth, db)
    await r.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: 'Example123!', displayName: 'テスト' })
    const me = auth.currentUser!.uid
    await markEmailVerified(me)
    await r.auth.reloadUser()
    const first = await r.teams.create('一つ目', '名前')
    const second = await r.teams.create('二つ目', '名前')
    const seen: (string | null | undefined)[] = []
    const off = r.users.subscribeProfile(me, (p) => seen.push(p?.teamId))
    await waitFor<UserProfile | null>((cb) => r.users.subscribeProfile(me, cb), (p) => p?.teamId === second)
    // サーバーにつながらない状態でも、切り替えは購読にすぐ届く
    await disableNetwork(db)
    const selecting = r.teams.select(first)
    await expect.poll(() => seen.at(-1), { timeout: 3000 }).toBe(first)
    await enableNetwork(db)
    await selecting
    off()
    // 所属していないチームへの切り替えは、ルールが拒否する
    await expect(r.teams.select('outsider')).rejects.toThrow()
  })
  it('deletes all nested data and codes, preserves other teams and supports resuming after interruption', async () => {
    const a = await client(), b = await client()
    const ua = (await waitFor<AuthUser | null>((cb) => a.auth.onAuthStateChanged(cb), (u) => !!u))!
    const ub = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!
    const t = await a.teams.create('削除対象', '管理者')
    const code = await a.teams.getJoinCode(t)
    await b.teams.join(code, 'メンバー')
    const other = await b.teams.create('維持するチーム', '維持する名前')
    const e = await a.events.create(t, {title:'予定',typeId:'practice',startAt:new Date(),place:null})
    const item = await a.equipment.add(t, {name:'用具'})
    await b.equipment.hold(t, item)
    await expect(b.teams.remove(t)).rejects.toThrow()
    // 削除開始後にタブを閉じた状態を再現。100件のページ境界を超えるメモも清掃する。
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      const batch = writeBatch(db)
      batch.update(doc(db, 'teams', t), {deletionUid: ua.uid})
      for (let n=0;n<205;n++) batch.set(doc(db, `teams/${t}/events/${e}/notes/n${n}`),
        {authorUid:ub.uid,authorName:'メンバー',body:'メモ',createdAt:now()})
      await batch.commit()
    })
    // 削除中でも既存メンバーは通常どおり使える。新規参加だけは止める
    await expect(b.events.addNote(t,e,'削除中のメモ')).resolves.toBeUndefined()
    await expect(b.equipment.add(t,{name:'削除中の用具'})).resolves.toBeTypeOf('string')
    const newcomer = await client()
    await expect(newcomer.teams.join(code,'削除中への参加')).rejects.toThrow()
    await Promise.all([a.teams.remove(t), a.teams.remove(t)])
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      for (const path of [`teams/${t}/events/${e}/notes`, `teams/${t}/events`, `teams/${t}/equipment`,
        `teams/${t}/equipmentNames`, `teams/${t}/members`, `teams/${t}/private`])
        expect((await getDocs(collection(db,path))).empty).toBe(true)
      expect((await getDoc(doc(db,'teams',t))).exists()).toBe(false)
      expect((await getDoc(doc(db,'joinCodes',code))).exists()).toBe(false)
      expect((await getDoc(doc(db,'users',ua.uid))).data()).toMatchObject({teamIds:[],teamId:null})
      expect((await getDoc(doc(db,'users',ub.uid))).data()).toMatchObject({teamIds:[other],teamId:other,displayName:'テスト'})
      expect((await getDoc(doc(db,'teams',other))).exists()).toBe(true)
    })
  })
  it('keeps members working when a deletion is abandoned midway, and lets them leave with consistent item counts', async () => {
    const a = await client(), b = await client()
    const ua = (await waitFor<AuthUser | null>((cb) => a.auth.onAuthStateChanged(cb), (u) => !!u))!
    const ub = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!
    const t = await a.teams.create('放置される削除', '管理者')
    await b.teams.join(await a.teams.getJoinCode(t), 'メンバー')
    const held = await a.equipment.add(t, {name:'持っている用具'})
    await b.equipment.hold(t, held)
    // 管理者が削除を始めたまま戻ってこない状態を再現
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore() as unknown as Firestore, 'teams', t), {deletionUid: ua.uid})
    })
    const e = await a.events.create(t, {title:'予定',typeId:'practice',startAt:new Date(),place:null}).catch(() => null)
    expect(e).toBeTypeOf('string')
    await b.events.setAttendance(t, e!, 'late')
    await b.equipment.release(t, held)
    await b.equipment.hold(t, held)
    await b.teams.leave(t)
    expect(await waitFor<UserProfile | null>((cb) => b.users.subscribeProfile(ub.uid, cb), (p) => !(p?.teamIds ?? []).includes(t)))
      .toMatchObject({teamIds: [], teamId: null})
    const item = await waitFor<EquipmentItem[]>((cb) => a.equipment.subscribe(t, cb), (items) => items.length === 1 && !items[0].holderUid)
    expect(item[0].holderUid).toBeNull()
  })
  it('migrates legacy single-team profiles without losing the membership', async () => {
    const r = await client()
    const user = (await waitFor<AuthUser | null>((cb) => r.auth.onAuthStateChanged(cb), (u) => !!u))!
    const t = await r.teams.create('旧チーム','旧表示名')
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      await setDoc(doc(db,'users',user.uid), {displayName:'アカウント名',teamId:t})
    })
    await r.auth.signOut()
    await r.auth.signIn(user.email, 'Example123!')
    expect(await waitFor<UserProfile | null>((cb) => r.users.subscribeProfile(user.uid,cb))).toMatchObject({teamId:t,teamIds:[t],displayName:'アカウント名'})
  })
})

describe('multi-team security boundaries (#24)', () => {
  it('rejects forged additions, removals of unrelated teams and team deletion by a member', async () => {
    const db = dbFor('member')
    await assertFails(updateDoc(doc(db,'users/member'), {teamIds:['t','invented'],teamId:'invented',membershipChangeTeamId:'invented'}))
    await assertFails(updateDoc(doc(db,'users/member'), {teamIds:[],teamId:null,membershipChangeTeamId:'t'}))
    await assertFails(updateDoc(doc(db,'teams/t'), {deletionUid:'member'}))
    await assertFails(deleteDoc(doc(db,'teams/t')))
    await assertFails(updateDoc(doc(dbFor('admin'),'users/member'), {displayName:'偽装'}))
    await assertFails(getDoc(doc(dbFor('other'),'users/member')))
    await assertFails(updateDoc(doc(db,'users/member'), {teamIds:['t','t']}))
  })
  it('keeps existing members working after deletion begins; only its initiator can clean up', async () => {
    const admin = dbFor('admin'), member = dbFor('member')
    await assertSucceeds(updateDoc(doc(admin,'teams/t'), {deletionUid:'admin'}))
    await assertFails(updateDoc(doc(admin,'teams/t'), {deletionUid:'member'}))
    // 削除が完了するまで、既存メンバーは通常どおり書き込める
    await assertSucceeds(setDoc(doc(admin,'teams/t/events/new'),eventData()))
    await assertSucceeds(updateDoc(doc(member,'teams/t/events/e'), {'attendance.member':'late',updatedAt:serverTimestamp()}))
    // 清掃用の無条件削除は開始した管理者だけ
    await assertFails(deleteDoc(doc(member,'teams/t/equipment/item')))
    await assertFails(deleteDoc(doc(member,'teams/t/members/member')))
    await assertFails(deleteDoc(doc(admin,'teams/t')))
    // 管理者であっても、メンバー削除と所属更新は同一書き込みが必要。
    await assertFails(deleteDoc(doc(admin,'teams/t/members/member')))
    await assertSucceeds(deleteDoc(doc(admin,'teams/t/equipment/item')))
  })
})

// #31：Google ログイン。テストではポップアップの代わりに、Auth エミュレータが受け付ける署名なしの ID トークンでログインする
function googleClient(account: { email: string; name: string }, googleSignIn?: (auth: Auth) => Promise<UserCredential>) {
  const { auth, db } = emulatorApp()
  const idToken = JSON.stringify({ sub: randomUUID(), email: account.email, email_verified: true, name: account.name })
  const repo = createFirestoreRepository(auth, db, {
    googleSignIn: googleSignIn ?? ((a) => signInWithCredential(a, GoogleAuthProvider.credential(idToken))),
    googleReauthenticate: (user) => reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken)),
  })
  return { repo, auth }
}
describe('Google sign-in (#31)', () => {
  it('creates a verified account named after the Google account, which can create a team right away', async () => {
    const { repo } = googleClient({ email: `${randomUUID()}@gmail.example`, name: 'グーグル 花子' })
    await repo.auth.signInWithGoogle()
    const me = (await waitFor<AuthUser | null>((cb) => repo.auth.onAuthStateChanged(cb), (u) => !!u))!
    expect(me.emailVerified).toBe(true)
    const profile = await waitFor<UserProfile | null>((cb) => repo.users.subscribeProfile(me.uid, cb), (p) => !!p)
    expect(profile).toMatchObject({ displayName: 'グーグル 花子', teamIds: [] })
    await expect(repo.teams.create('Google のチーム', '花子')).resolves.toBeTypeOf('string')
  })
  it('does nothing when the Google window is closed, and reports a blocked window', async () => {
    const closed = googleClient({ email: 'unused@gmail.example', name: '未使用' }, async () => {
      throw new FirebaseError('auth/popup-closed-by-user', 'closed')
    })
    await expect(closed.repo.auth.signInWithGoogle()).resolves.toBeUndefined()
    expect(closed.auth.currentUser).toBeNull()
    const blocked = googleClient({ email: 'unused@gmail.example', name: '未使用' }, async () => {
      throw new FirebaseError('auth/popup-blocked', 'blocked')
    })
    await expect(blocked.repo.auth.signInWithGoogle()).rejects.toThrow('ポップアップを許可')
  })
  it('signs into the existing account when the same verified email was registered with a password', async () => {
    const email = `${randomUUID()}@gmail.example`
    const { auth, db } = emulatorApp()
    const byPassword = createFirestoreRepository(auth, db)
    await byPassword.auth.signUp({ email, password: 'Example123!', displayName: 'パスワード 太郎' })
    const uid = auth.currentUser!.uid
    await markEmailVerified(uid)
    await byPassword.auth.reloadUser()
    const teamId = await byPassword.teams.create('既存のチーム', '太郎')

    const google = googleClient({ email, name: 'グーグル 太郎' })
    await google.repo.auth.signInWithGoogle()
    expect(google.auth.currentUser!.uid).toBe(uid)
    const profile = await waitFor<UserProfile | null>((cb) => google.repo.users.subscribeProfile(uid, cb), (p) => !!p)
    expect(profile).toMatchObject({ displayName: 'パスワード 太郎', teamIds: [teamId] })
    // 確認済みのアカウントでは、Google と連携したあともパスワードでログインできる
    await byPassword.auth.signOut()
    await expect(signInWithEmailAndPassword(auth, email, 'Example123!')).resolves.toBeTruthy()
  })
})

describe('stale membership recovery (#97)', () => {
  async function fixture() {
    const repo = await client()
    const user = (await waitFor<AuthUser | null>((cb) => repo.auth.onAuthStateChanged(cb), (u) => !!u))!
    const team = await repo.teams.create('有効なチーム', 'テスト')
    return { repo, user, team }
  }
  async function corruptProfile(uid: string, ids: string[], selected: string | null) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `users/${uid}`), { teamIds: ids, teamId: selected })
    })
  }
  it('repairs two missing teams, keeps the active membership and reconnects without errors', async () => {
    const { repo, user, team } = await fixture()
    await corruptProfile(user.uid, ['missing-one', 'missing-two', team], team)
    const errors: string[] = []
    const offErrors = repo.onError!((e) => errors.push(e.message))
    const off = repo.teams.subscribeMine(() => {})
    try {
      const profile = await waitFor<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), (p) => p?.teamIds.length === 1)
      expect(profile).toMatchObject({ teamIds: [team], teamId: team })
      expect((await waitFor<Team[]>((cb) => repo.teams.subscribeMine(cb), (ts) => ts.length === 1))[0].id).toBe(team)
      expect(errors).toEqual([])
    } finally { off(); offErrors() }
  })
  it('repairs an invalid selected team while its team, members and events are subscribed', async () => {
    const { repo, user, team } = await fixture()
    await corruptProfile(user.uid, ['missing', team], 'missing')
    const errors: string[] = []
    const stops = [
      repo.onError!((e) => errors.push(e.message)),
      repo.teams.subscribeMine(() => {}),
      repo.teams.subscribe('missing', () => {}),
      repo.teams.subscribeMembers('missing', () => {}),
      repo.events.subscribeUpcoming('missing', () => {}),
    ]
    try {
      const profile = await waitFor<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), (p) => p?.teamId === team)
      expect(profile?.teamIds).toEqual([team])
      expect(await waitFor<Member[]>((cb) => repo.teams.subscribeMembers('missing', cb))).toEqual([])
      expect(errors).toEqual([])
    } finally { stops.forEach((stop) => stop()) }
  })
  it('returns to no selected team when all memberships are invalid', async () => {
    const { repo, user } = await fixture()
    await corruptProfile(user.uid, ['missing-one', 'missing-two'], 'missing-one')
    const off = repo.teams.subscribeMine(() => {})
    try {
      const profile = await waitFor<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), (p) => p?.teamId === null)
      expect(profile?.teamIds).toEqual([])
    } finally { off() }
  })
  it('repairs a stale membership in an existing team after the member document is removed', async () => {
    const { repo, user, team } = await fixture()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), `teams/${team}/members/${user.uid}`))
    })
    const off = repo.teams.subscribeMine(() => {})
    try {
      const profile = await waitFor<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), (p) => p?.teamId === null)
      expect(profile?.teamIds).toEqual([])
    } finally { off() }
  })
  it('rules reject removing a valid membership or adding a team through repair fields', async () => {
    const { user, team } = await fixture()
    const db = dbFor(user.uid)
    const ref = doc(db, 'users', user.uid)
    await assertFails(updateDoc(ref, { teamIds: [], teamId: null, membershipChangeTeamId: team }))
    await assertFails(updateDoc(ref, { teamIds: [team, 'arbitrary'], teamId: 'arbitrary', membershipChangeTeamId: 'arbitrary' }))
    await assertFails(updateDoc(doc(dbFor('outsider'), 'users', user.uid), { teamIds: [], teamId: null, membershipChangeTeamId: team }))
    expect((await getDoc(ref)).data()?.teamIds).toEqual([team])
  })
})

describe('saved places (#45)', () => {
  it('preserves ordered places and existing event text; validates SDK and direct writes', async () => {
    const a = await client(), b = await client(), t = await a.teams.create('場所テスト', '名前')
    await b.teams.join(await a.teams.getJoinCode(t), '名前')
    await a.teams.updateSettings(t, { places: [' 第一会議室 ', '体育館'] })
    expect((await waitFor<Team | null>((cb) => a.teams.subscribe(t, cb), (team) => !!team?.settings.places))?.settings.places).toEqual(['第一会議室', '体育館'])
    const e = await a.events.create(t, { title: '集まり', typeId: 'practice', startAt: new Date(Date.now() + 86400000), place: '第一会議室' })
    await a.teams.updateSettings(t, { places: ['体育館', '新会議室'] })
    expect((await waitFor<Team | null>((cb) => a.teams.subscribe(t, cb), (team) => team?.settings.places?.[0] === '体育館'))?.settings.places).toEqual(['体育館', '新会議室'])
    expect((await waitFor<TeamEvent[]>((cb) => a.events.subscribeUpcoming(t, cb)))[0]).toMatchObject({ id: e, place: '第一会議室' })
    await expect(b.teams.updateSettings(t, { places: ['無権限'] })).rejects.toThrow()
    await expect(a.teams.updateSettings(t, { places: Array.from({ length: 21 }, (_, i) => `${i}`) })).rejects.toThrow()
    await expect(a.teams.updateSettings(t, { places: ['重複', '重複'] })).rejects.toThrow()
    await expect(a.teams.updateSettings(t, { places: [' '] })).rejects.toThrow()
    const user = (await waitFor<AuthUser | null>((cb) => a.auth.onAuthStateChanged(cb), (u) => !!u))!
    const ref = doc(dbFor(user.uid), 'teams', t)
    for (const bad of [Array(21).fill('x'), [123], ['x'.repeat(101)], [''], ['重複', '重複']]) await assertFails(updateDoc(ref, { 'settings.places': bad }))
    await a.teams.updateSettings(t, { places: [] })
  })
})

describe('account settings and deletion (#68, #100)', () => {
  it('updates only the account name and configures Japanese auth', async () => {
    const { auth, db } = emulatorApp(), r = createFirestoreRepository(auth, db)
    expect(auth.languageCode).toBe('ja')
    await r.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: 'Example123!', displayName: '登録名' })
    const uid = auth.currentUser!.uid
    await markEmailVerified(uid); await r.auth.reloadUser()
    const t = await r.teams.create('チーム', 'チーム内の名前')
    await r.users.updateAccountName(' 新しいアカウント名 ')
    expect((await waitFor<UserProfile | null>((cb) => r.users.subscribeProfile(uid, cb)))?.displayName).toBe('新しいアカウント名')
    expect((await waitFor<Member[]>((cb) => r.teams.subscribeMembers(t, cb)))[0].displayName).toBe('チーム内の名前')
    await expect(r.users.updateAccountName(' ')).rejects.toThrow()
  })
  it('reauthenticates and deletes all memberships, releases held equipment and deletes the auth user', async () => {
    const a = await client(), b = await client()
    const uid = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    const first = await a.teams.create('第一', '管理者'), second = await a.teams.create('第二', '管理者')
    await b.teams.join(await a.teams.getJoinCode(first), '名前')
    await b.teams.join(await a.teams.getJoinCode(second), '名前')
    const item = await a.equipment.add(first, { name: 'ケース' })
    await b.equipment.hold(first, item)
    await expect(b.auth.deleteAccount({ confirmation: '削除', password: 'wrong' })).rejects.toThrow()
    expect((await waitFor<UserProfile | null>((cb) => b.users.subscribeProfile(uid, cb)))?.teamIds).toEqual([first, second])
    await b.auth.deleteAccount({ confirmation: '削除', password: 'Example123!' })
    expect(await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb))).toBeNull()
    expect((await waitFor<EquipmentItem[]>((cb) => a.equipment.subscribe(first, cb)))[0].holderUid).toBeNull()
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), 'users', uid))).exists()).toBe(false)
      for (const t of [first, second]) expect((await getDoc(doc(ctx.firestore(), 'teams', t, 'members', uid))).exists()).toBe(false)
    })
  })
  it('does not leave any valid team if the user is a last admin elsewhere', async () => {
    const a = await client(), b = await client()
    const first = await a.teams.create('参加先', '管理者')
    await b.teams.join(await a.teams.getJoinCode(first), '名前')
    const last = await b.teams.create('最後の管理者', '名前')
    const uid = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    await expect(b.auth.deleteAccount({ confirmation: '削除', password: 'Example123!' })).rejects.toThrow('最後の管理者')
    expect((await waitFor<UserProfile | null>((cb) => b.users.subscribeProfile(uid, cb)))?.teamIds).toEqual([first, last])
  })
  it('resumes partial deletion and blocks new joins and holds while deleting', async () => {
    const a = await client(), b = await client()
    const t = await a.teams.create('チーム', '管理者'), next = await a.teams.create('別チーム', '管理者')
    await b.teams.join(await a.teams.getJoinCode(t), '名前')
    const uid = (await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    await updateDoc(doc(dbFor(uid), 'users', uid), { deletingAccount: true })
    await expect(b.teams.join(await a.teams.getJoinCode(next), '名前')).rejects.toThrow()
    const item = await a.equipment.add(t, { name: 'ケース' })
    await expect(b.equipment.hold(t, item)).rejects.toThrow()
    await b.teams.leave(t)
    await b.auth.deleteAccount({ confirmation: '削除', password: 'Example123!' })
    expect(await waitFor<AuthUser | null>((cb) => b.auth.onAuthStateChanged(cb))).toBeNull()
  })
  it('rules prevent deleting another profile, a member profile and deleting with stale authentication', async () => {
    const r = await client(), t = await r.teams.create('チーム', '名前')
    const uid = (await waitFor<AuthUser | null>((cb) => r.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    await assertFails(deleteDoc(doc(dbFor(uid), 'users', uid)))
    await assertFails(deleteDoc(doc(dbFor('other'), 'users', uid)))
    await assertFails(updateDoc(doc(dbFor('other'), 'users', uid), { deletingAccount: true }))
    await updateDoc(doc(dbFor(uid), 'users', uid), { deletingAccount: true })
    await assertFails(deleteDoc(doc(dbFor(uid), 'users', uid)))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'teams', t, 'members', uid))
      await updateDoc(doc(ctx.firestore(), 'users', uid), { teamIds: [], teamId: null })
    })
    const stale = env.authenticatedContext(uid, { email_verified: true, auth_time: 1 }).firestore() as unknown as Firestore
    await assertFails(deleteDoc(doc(stale, 'users', uid)))
  })
})


describe('Google account deletion and recovery (#68)', () => {
  it('reauthenticates the same Google account and deletes an unassigned account', async () => {
    const { repo, auth } = googleClient({ email: `${randomUUID()}@gmail.example`, name: 'テスト' })
    await repo.auth.signInWithGoogle()
    await repo.auth.deleteAccount({ confirmation: '削除' })
    expect(auth.currentUser).toBeNull()
  })
  it('can retry when the profile was deleted but the Auth account remained', async () => {
    const { repo, auth } = googleClient({ email: `${randomUUID()}@gmail.example`, name: 'テスト' })
    await repo.auth.signInWithGoogle()
    const uid = auth.currentUser!.uid
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'users', uid)) })
    await repo.auth.deleteAccount({ confirmation: '削除' })
    expect(auth.currentUser).toBeNull()
  })
})

describe('account deletion interruption', () => {
  it('can unlock a failed deletion to fix administrator roles without restoring removed memberships', async () => {
    const r = await client(), t = await r.teams.create('管理者の確認', '名前')
    const uid = (await waitFor<AuthUser | null>((cb) => r.auth.onAuthStateChanged(cb), (u) => !!u))!.uid
    await updateDoc(doc(dbFor(uid), 'users', uid), { deletingAccount: true })
    await r.auth.cancelAccountDeletion()
    expect((await waitFor<UserProfile | null>((cb) => r.users.subscribeProfile(uid, cb)))?.deletingAccount).toBe(false)
    const item = await r.equipment.add(t, { name: 'ケース' })
    await r.equipment.hold(t, item)
    expect((await waitFor<EquipmentItem[]>((cb) => r.equipment.subscribe(t, cb)))[0].holderUid).toBe(uid)
  })
})
