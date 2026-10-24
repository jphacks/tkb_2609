import type { AuthUser, EquipmentItem, EventNote, Member, Team, TeamEvent, UserProfile } from '../src/types'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
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
const dbFor = (u: string) => env.authenticatedContext(u).firestore() as unknown as Firestore
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
async function client(): Promise<Repository> {
  const app = initializeApp({ projectId, apiKey: 'fake-api-key', appId: 'fake-app-id' }, randomUUID())
  apps.push(app)
  const auth = getAuth(app),
    db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const r = createFirestoreRepository(auth, db)
  await r.auth.signUp({ email: `${randomUUID()}@example.invalid`, password: 'Example123!', displayName: 'テスト' })
  return r
}
describe('Firestore repository against Auth + Firestore emulators', () => {
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
    expect(errors).toHaveLength(1)
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
    await expect(b.events.addNote(t,e,'停止後のメモ')).rejects.toThrow()
    await expect(b.equipment.add(t,{name:'停止後の用具'})).rejects.toThrow()
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
  it('locks writes and membership changes after deletion begins; only its initiator can clean up', async () => {
    const admin = dbFor('admin'), member = dbFor('member')
    await assertSucceeds(updateDoc(doc(admin,'teams/t'), {deletionUid:'admin'}))
    await assertFails(updateDoc(doc(admin,'teams/t'), {deletionUid:'member'}))
    await assertFails(updateDoc(doc(admin,'teams/t'), {name:'変更'}))
    await assertFails(setDoc(doc(admin,'teams/t/events/new'),eventData()))
    await assertFails(updateDoc(doc(member,'teams/t/events/e'), {'attendance.member':'late',updatedAt:serverTimestamp()}))
    await assertFails(deleteDoc(doc(member,'teams/t/equipment/item')))
    await assertFails(deleteDoc(doc(member,'teams/t/members/member')))
    await assertFails(deleteDoc(doc(admin,'teams/t')))
    // 管理者であっても、メンバー削除と所属更新は同一書き込みが必要。
    await assertFails(deleteDoc(doc(admin,'teams/t/members/member')))
    await assertSucceeds(deleteDoc(doc(admin,'teams/t/equipment/item')))
  })
})
