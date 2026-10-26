/** opt-in。通常のnpm testでは走らず、npm run scale:checkだけで実行する。 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, collectionGroup, connectFirestoreEmulator, doc, getCountFromServer, getDoc, getDocs, getFirestore, query, where, type Firestore, type Transaction, type TransactionOptions } from 'firebase/firestore'
import { createFirestoreRepository } from '../src/data/firebase/firestoreRepository'
import type { Unsubscribe } from '../src/data/repository'
import type { EquipmentItem, EventNote, Member, TeamEvent } from '../src/types'
import { noteData, presets, SCALE_PASSWORD, SCALE_PROJECT, scaleEndpoints, seedScale, writeScaleDocuments, type ScaleFixture } from '../scripts/seed-scale'

const probe = vi.hoisted(() => ({ reads: 0, queries: 0, emptyQueries: 0, txReads: 0, sets: 0, updates: 0, deletes: 0, batches: 0, maxBatch: 0, failNotesAfterCommit: false, injectScope: '', holderCommitCountdown: 0, maxQuery: 0, serverSnapshotDocuments: 0, cacheSnapshotDocuments: 0 }))
vi.mock('firebase/firestore', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...sdk,
    onSnapshot: ((...args: unknown[]) => {
      const next = args[1] as (snapshot: { docs?: unknown[]; metadata: { fromCache: boolean } }) => void
      return Reflect.apply(sdk.onSnapshot, undefined, [args[0], (snapshot: { docs?: unknown[]; metadata: { fromCache: boolean } }) => {
        const count = snapshot.docs ? Math.max(1, snapshot.docs.length) : 1
        if (snapshot.metadata.fromCache) probe.cacheSnapshotDocuments += count
        else probe.serverSnapshotDocuments += count
        next(snapshot)
      }, ...args.slice(2)])
    }) as typeof sdk.onSnapshot,
    getDoc: (async (...args: Parameters<typeof sdk.getDoc>) => { const result = await sdk.getDoc(...args); probe.reads++; return result }) as typeof sdk.getDoc,
    getDocs: (async (...args: Parameters<typeof sdk.getDocs>) => { const result = await sdk.getDocs(...args); probe.queries++; probe.reads += Math.max(1, result.size); if (result.empty) probe.emptyQueries++; probe.maxQuery = Math.max(probe.maxQuery, result.size); return result }) as typeof sdk.getDocs,
    updateDoc: (async (...args: Parameters<typeof sdk.updateDoc>) => { await sdk.updateDoc(...args); probe.updates++ }) as typeof sdk.updateDoc,
    deleteDoc: (async (...args: Parameters<typeof sdk.deleteDoc>) => { await sdk.deleteDoc(...args); probe.deletes++ }) as typeof sdk.deleteDoc,
    runTransaction: (async (db: Firestore, update: (tx: Transaction) => Promise<unknown>, options?: TransactionOptions) => {
      let writes = { sets: 0, updates: 0, deletes: 0 }, released = false
      const result = await sdk.runTransaction(db, async (tx) => {
        writes = { sets: 0, updates: 0, deletes: 0 }; released = false
        const wrapped = new Proxy(tx, { get(target, property) {
          const value = Reflect.get(target, property)
          if (property === 'get') return (...args: unknown[]) => { probe.txReads++; return Reflect.apply(value, target, args) }
          if (property === 'set' || property === 'update' || property === 'delete') return (...args: unknown[]) => { writes[property === 'set' ? 'sets' : property === 'update' ? 'updates' : 'deletes']++; const [ref, data] = args as [{ path: string }, Record<string, unknown>]; released ||= property === 'update' && ref.path.startsWith(probe.injectScope) && ref.path.includes('/equipment/') && data.holderUid === null; Reflect.apply(value, target, args); return wrapped }
          return typeof value === 'function' ? value.bind(target) : value
        } })
        return update(wrapped)
      }, options)
      probe.sets += writes.sets; probe.updates += writes.updates; probe.deletes += writes.deletes
      if (released && probe.holderCommitCountdown > 0 && --probe.holderCommitCountdown === 0) throw new Error('scale check: simulated lost holder response')
      return result
    }) as typeof sdk.runTransaction,
    writeBatch: ((...args: Parameters<typeof sdk.writeBatch>) => {
      const batch = sdk.writeBatch(...args)
      let sets = 0, updates = 0, deletes = 0, notes = false
      const wrapped = new Proxy(batch, { get(target, property) {
        const value = Reflect.get(target, property)
        if (property === 'delete') return (ref: { path: string }) => { deletes++; notes ||= ref.path.startsWith(probe.injectScope) && ref.path.includes('/notes/'); Reflect.apply(value, target, [ref]); return wrapped }
        if (property === 'set' || property === 'update') return (...args: unknown[]) => { if (property === 'set') sets++; else updates++; Reflect.apply(value, target, args); return wrapped }
        if (property === 'commit') return async () => {
          await Reflect.apply(value, target, [])
          probe.sets += sets; probe.updates += updates; probe.deletes += deletes; probe.batches++; probe.maxBatch = Math.max(probe.maxBatch, sets + updates + deletes)
          // commit成功直後の応答喪失を模擬。書込済みデータを再実行で壊さないか確認する。
          if (notes && probe.failNotesAfterCommit) { probe.failNotesAfterCommit = false; throw new Error('scale check: simulated lost commit response') }
        }
        return typeof value === 'function' ? value.bind(target) : value
      } })
      return wrapped
    }) as typeof sdk.writeBatch,
  }
})

const enabled = process.env.BUKATSU_SCALE_CHECK === '1'
const apps: FirebaseApp[] = []
let env: RulesTestEnvironment | undefined
const output = '.scale-artifacts'
const measurements: { phase: string; ms: number; counts: Record<string, number>; result?: unknown }[] = []
function resetProbe() { for (const key of ['reads', 'queries', 'emptyQueries', 'txReads', 'sets', 'updates', 'deletes', 'batches', 'maxBatch', 'maxQuery', 'serverSnapshotDocuments', 'cacheSnapshotDocuments'] as const) probe[key] = 0 }
async function measure<T>(phase: string, action: () => Promise<T>): Promise<T> {
  process.stdout.write(`scale: starting ${phase}\n`)
  resetProbe(); const start = performance.now()
  try {
    const result = await action()
    measurements.push({ phase, ms: performance.now() - start, counts: { reads: probe.reads, queries: probe.queries, emptyQueries: probe.emptyQueries, txReads: probe.txReads, sets: probe.sets, updates: probe.updates, deletes: probe.deletes, batches: probe.batches, maxBatch: probe.maxBatch, maxQuery: probe.maxQuery, serverSnapshotDocuments: probe.serverSnapshotDocuments, cacheSnapshotDocuments: probe.cacheSnapshotDocuments }, ...(Array.isArray(result) ? { result: { documents: result.length, jsonBytes: Buffer.byteLength(JSON.stringify(result)) } } : {}) })
    process.stdout.write(`scale: ${phase}: ${Math.round(performance.now() - start)}ms\n`)
    return result
  } catch (error) { console.error(`scale: ${phase} failed`); throw error }
}
function first<T>(subscribe: (cb: (value: T) => void) => Unsubscribe, accept: (v: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    let off: Unsubscribe = () => {}
    const timer = setTimeout(() => { off(); reject(new Error('scale subscription timed out')) }, 60000)
    off = subscribe((v) => { if (accept(v)) { clearTimeout(timer); off(); resolve(v) } })
  })
}
async function client(fixture: ScaleFixture) {
  const app = initializeApp({ projectId: SCALE_PROJECT, apiKey: 'fake-api-key', appId: 'fake-scale-app' }, `scale-${apps.length}`)
  apps.push(app)
  const auth = getAuth(app), db = getFirestore(app)
  const [host, port] = fixture.firestoreHost.split(':')
  connectFirestoreEmulator(db, host, Number(port)); connectAuthEmulator(auth, `http://${fixture.authHost}`, { disableWarnings: true })
  await signInWithEmailAndPassword(auth, fixture.admin.email, SCALE_PASSWORD)
  return { db, repo: createFirestoreRepository(auth, db) }
}
async function adminCheck<T>(action: (db: Firestore) => Promise<T>) {
  let result!: T
  await env!.withSecurityRulesDisabled(async (ctx) => { result = await action(ctx.firestore() as unknown as Firestore) })
  return result
}
async function assertRemoved(fixture: ScaleFixture) {
  await adminCheck(async (db) => {
    expect((await getDoc(doc(db, 'teams', fixture.teamId))).exists()).toBe(false)
    for (const path of ['events', 'members', 'equipment', 'equipmentNames', 'private']) expect((await getDocs(collection(db, 'teams', fixture.teamId, path))).size).toBe(0)
    expect((await getCountFromServer(collectionGroup(db, 'notes'))).data().count).toBe(0)
    expect((await getDocs(query(collection(db, 'joinCodes'), where('teamId', '==', fixture.teamId)))).size).toBe(0)
    for (const uid of fixture.memberIds) {
      const p = (await getDoc(doc(db, 'users', uid))).data()!
      expect(p.teamIds).toEqual([fixture.controlTeamId]); expect(p.teamId).toBe(fixture.controlTeamId)
      expect((await getDoc(doc(db, 'teams', fixture.controlTeamId, 'members', uid))).exists()).toBe(true)
    }
  })
}
afterAll(async () => {
  if (!enabled) return
  await mkdir(output, { recursive: true })
  await writeFile(`${output}/measurements.json`, JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, measuredAt: new Date().toISOString(), measurements }, null, 2))
  await Promise.all(apps.map(deleteApp)); await env?.cleanup()
})
describe.skipIf(!enabled)('large-data validation (#69)', () => {
  it('measures demo and large reads, removal and deletion with restart', async () => {
    const endpoints = scaleEndpoints(), [host, port] = endpoints.firestoreHost.split(':')
    env = await initializeTestEnvironment({ projectId: SCALE_PROJECT, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
    await mkdir(output, { recursive: true })
    for (const preset of ['demo', 'large'] as const) {
      const fixture = await seedScale(presets[preset], (n) => { if (n % 10000 === 0) process.stdout.write(`scale: ${preset} seeded ${n}\n`) })
      await writeFile(`${output}/${preset}.json`, JSON.stringify(fixture, null, 2))
      const { repo } = await client(fixture), t = fixture.teamId
      const errors: string[] = [], offErrors = repo.onError!((e) => errors.push(e.message))
      await measure(`${preset}.members`, () => first<Member[]>((cb) => repo.teams.subscribeMembers(t, cb), (rows) => rows.length === fixture.options.members))
      await measure(`${preset}.events`, () => first<TeamEvent[]>((cb) => repo.events.subscribeUpcoming(t, cb), (rows) => rows.length === fixture.options.events))
      await measure(`${preset}.equipment`, () => first<EquipmentItem[]>((cb) => repo.equipment.subscribe(t, cb), (rows) => rows.length === fixture.options.equipment))
      await measure(`${preset}.notes`, () => first<EventNote[]>((cb) => repo.events.subscribeNotes(t, 'event-0', cb), (rows) => rows.length === fixture.options.notesPerEvent))
      await measure(`${preset}.attendance`, () => repo.events.setAttendance(t, 'event-0', 'late'))
      if (preset === 'large') {
        // 100点の解放と所属1件だけの解除。もう1チームは保持する。
        await measure('large.removeMemberWith100Items', () => repo.teams.removeMember(t, fixture.member.uid))
        await adminCheck(async (db) => {
          expect((await getDoc(doc(db, 'teams', t, 'members', fixture.member.uid))).exists()).toBe(false)
          expect((await getDoc(doc(db, 'users', fixture.member.uid))).data()?.teamIds).toEqual([fixture.controlTeamId])
          expect((await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', fixture.member.uid)))).size).toBe(0)
        })
        // 450件の清掃バッチを越える境界用に、先頭予定だけ1001メモへ増やす。
        await writeScaleDocuments(Array.from({ length: 801 }, (_, i) => ({ path: `teams/${t}/events/event-0/notes/note-${i + 200}`, data: noteData(fixture.admin.uid, i + 200) })))
        probe.injectScope = `teams/${t}/events/event-0/`; probe.failNotesAfterCommit = true
        await expect(repo.events.remove(t, 'event-0')).rejects.toThrow()
        await adminCheck(async (db) => {
          expect((await getDoc(doc(db, 'teams', t, 'events', 'event-0'))).data()?.deleting).toBe(true)
          expect((await getCountFromServer(collection(db, 'teams', t, 'events', 'event-0', 'notes'))).data().count).toBe(551)
        })
        const resumed = await client(fixture)
        await measure('large.eventDeleteResume551Notes', () => resumed.repo.events.remove(t, 'event-0'))
        probe.injectScope = `teams/${t}/`; probe.failNotesAfterCommit = true
        await expect(resumed.repo.teams.remove(t)).rejects.toThrow()
        await adminCheck(async (db) => {
          expect((await getDoc(doc(db, 'teams', t))).data()?.deletionUid).toBe(fixture.admin.uid)
          expect((await getDoc(doc(db, 'teams', t, 'members', fixture.admin.uid))).exists()).toBe(true)
        })
        const reloaded = await client(fixture)
        await measure('large.teamDeleteResume', () => reloaded.repo.teams.remove(t))
      } else {
        await measure('demo.teamDelete', () => repo.teams.remove(t))
      }
      await assertRemoved(fixture); offErrors(); expect(errors).toEqual([])
    }
    // 削除試験で消したfixtureとは別に、比較用の両規模をexportへ残す。
    // 大規模のUIでは先頭予定だけにメモを用意する。
    for (const preset of ['demo', 'large'] as const) {
      const options = preset === 'large' ? { ...presets.large, noteEvents: 1 } : presets.demo
      const browserFixture = await seedScale(options)
      const filename = preset === 'demo' ? 'browser-demo.json' : 'browser.json'
      await writeFile(`${output}/${filename}`, JSON.stringify(browserFixture, null, 2))
    }
  }, 900000)
  it('resumes member removal after losing the response for the 50th released item', async () => {
    if (!env) {
      const endpoint = scaleEndpoints(), [host, port] = endpoint.firestoreHost.split(':')
      env = await initializeTestEnvironment({ projectId: SCALE_PROJECT, firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
    }
    const fixture = await seedScale({ ...presets.large, events: 0, notesPerEvent: 0 }), { repo } = await client(fixture), t = fixture.teamId
    probe.injectScope = `teams/${t}/`; probe.holderCommitCountdown = 50
    await measure('memberRemoval.interruptedAfter50Items', async () => {
      await expect(repo.teams.removeMember(t, fixture.member.uid)).rejects.toThrow()
    })
    await adminCheck(async (db) => {
      expect((await getDoc(doc(db, 'teams', t, 'members', fixture.member.uid))).data()?.heldCount).toBe(50)
      expect((await getDoc(doc(db, 'users', fixture.member.uid))).data()?.teamIds).toEqual([t, fixture.controlTeamId])
      expect((await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', fixture.member.uid)))).size).toBe(50)
    })
    const resumed = await client(fixture)
    await measure('memberRemoval.resumedRemaining50Items', () => resumed.repo.teams.removeMember(t, fixture.member.uid))
    await adminCheck(async (db) => {
      expect((await getDoc(doc(db, 'teams', t, 'members', fixture.member.uid))).exists()).toBe(false)
      expect((await getDoc(doc(db, 'users', fixture.member.uid))).data()?.teamIds).toEqual([fixture.controlTeamId])
      expect((await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', fixture.member.uid)))).size).toBe(0)
    })
  }, 60000)

})
