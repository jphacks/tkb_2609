/** エミュレータ専用。Node.js 24で実行する。本番設定・CLI認証情報を読み込まない。 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCALE_PROJECT = 'demo-bukatsu-scale'
export const SCALE_PASSWORD = 'ScaleOnly123!' // ローカルの架空アカウント専用
export const presets = {
  demo: { members: 50, events: 20, notesPerEvent: 20, equipment: 30 },
  large: { members: 100, events: 500, notesPerEvent: 200, equipment: 300 },
}
export interface ScaleOptions { members: number; events: number; notesPerEvent: number; equipment: number; noteEvents?: number }
export interface ScaleFixture {
  projectId: string; firestoreHost: string; authHost: string; teamId: string; controlTeamId: string
  options: ScaleOptions; admin: { uid: string; email: string }; member: { uid: string; email: string }
  memberIds: string[]; seededDocuments: number; seedMs: number
}
function localHost(value: string): string {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value)) throw new Error('Loopback emulator host:port is required')
  const port = Number(value.split(':')[1])
  if (port < 1024 || port > 65535) throw new Error('Invalid emulator port')
  return value
}
export function scaleEndpoints() {
  // projectは固定。環境変数から本番projectやサービスアカウントを受け取らない。
  return { projectId: SCALE_PROJECT, firestoreHost: localHost(process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:18080'), authHost: localHost(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:19099') }
}
export async function localJson(url: string, body?: unknown, owner = false): Promise<Record<string, unknown>> {
  const u = new URL(url)
  localHost(u.host)
  if (u.protocol !== 'http:') throw new Error('Only local emulator HTTP is allowed')
  const response = await fetch(u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: 'Bearer owner' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) })
  const result = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(`Emulator ${response.status}: ${JSON.stringify(result)}`)
  return result
}
function field(value: unknown): unknown {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } }
  return { mapValue: { fields: fields(value as Record<string, unknown>) } }
}
function fields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, field(value)]))
}
export async function writeScaleDocuments(documents: Iterable<{ path: string; data: Record<string, unknown> }>, endpoint = scaleEndpoints(), onProgress?: (written: number) => void) {
  if (endpoint.projectId !== SCALE_PROJECT) throw new Error('Only the fixed demo project is supported')
  localHost(endpoint.firestoreHost)
  let writes: unknown[] = [], written = 0
  const commit = async () => {
    await localJson(`http://${endpoint.firestoreHost}/v1/projects/${SCALE_PROJECT}/databases/(default)/documents:commit`, { writes }, true)
    written += writes.length; writes = []; onProgress?.(written)
  }
  for (const { path, data } of documents) {
    if (!/^(teams|users|joinCodes)\//.test(path)) throw new Error('Unexpected fixture path')
    writes.push({ update: { name: `projects/${SCALE_PROJECT}/databases/(default)/documents/${path}`, fields: fields(data) } })
    if (writes.length === 400) await commit()
  }
  if (writes.length) await commit()
  return written
}
export function noteData(uid: string, index: number, authorName = '検証メンバー000') {
  return { authorUid: uid, authorName, body: `検証メモ ${index}：集合場所・持ち物・連絡事項を確認してください。`, createdAt: new Date(Date.now() + index) }
}
export async function seedScale(options: ScaleOptions, onProgress?: (written: number) => void): Promise<ScaleFixture> {
  for (const [key, value] of Object.entries(options)) if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${key}`)
  if (options.members < 2 || options.members > 100 || options.events > 1000 || options.notesPerEvent > 1000 || options.equipment > 1000) throw new Error('Fixture limits: members2–100/events≤1000/notes≤1000/equipment≤1000')
  if ((options.noteEvents ?? options.events) > options.events) throw new Error('noteEvents exceeds events')
  const start = performance.now(), endpoint = scaleEndpoints(), id = randomUUID()
  const createUser = async (name: string) => {
    const email = `${name}-${id}@example.invalid`
    const user = await localJson(`http://${endpoint.authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, { email, password: SCALE_PASSWORD, returnSecureToken: true })
    const uid = user.localId as string
    await localJson(`http://${endpoint.authHost}/identitytoolkit.googleapis.com/v1/projects/${SCALE_PROJECT}/accounts:update`, { localId: uid, emailVerified: true }, true)
    return { uid, email }
  }
  const admin = await createUser('scale-admin'), member = await createUser('scale-member')
  const memberIds = [admin.uid, member.uid, ...Array.from({ length: options.members - 2 }, (_, i) => `scale-${id}-member-${i + 2}`)]
  const teamId = `scale-${id}`, controlTeamId = `scale-control-${id}`
  const heldBy = (i: number) => i < Math.min(100, Math.floor(options.equipment / 3)) ? admin.uid : i < Math.min(200, Math.floor(options.equipment / 3) * 2) ? member.uid : null
  const held = (uid: string) => Array.from({ length: options.equipment }, (_, i) => heldBy(i)).filter((u) => u === uid).length
  function* documents() {
    const team = { name: '大量データ検証', createdBy: admin.uid, adminUid: admin.uid, createdAt: new Date(), settings: { eventEditPolicy: 'all', eventTypes: [{ id: 'practice', label: '活動', color: '#2563eb' }], places: [] } }
    yield { path: `teams/${teamId}`, data: team }
    yield { path: `teams/${controlTeamId}`, data: { ...team, name: '所属保持の確認用' } }
    // コードはこの専用project内のrunごとに重複しないように生成する。
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const code = Array.from(randomBytes(8), (n) => alphabet[n % alphabet.length]).join('')
    yield { path: `joinCodes/${code}`, data: { teamId, createdAt: new Date() } }
    yield { path: `teams/${teamId}/private/joinCode`, data: { code } }
    for (const [i, uid] of memberIds.entries()) {
      yield { path: `users/${uid}`, data: { displayName: `検証アカウント${i}`, teamId, teamIds: [teamId, controlTeamId] } }
      const data = { displayName: `検証メンバー${i.toString().padStart(3, '0')}`, role: i === 0 ? 'admin' : 'member', joinedAt: new Date(), joinCode: '', equipmentChangeId: '', heldCount: held(uid) }
      yield { path: `teams/${teamId}/members/${uid}`, data }
      yield { path: `teams/${controlTeamId}/members/${uid}`, data: { ...data, heldCount: 0 } }
    }
    for (let i = 0; i < options.equipment; i++) {
      const name = `検証用具${i.toString().padStart(4, '0')}`, holderUid = heldBy(i)
      yield { path: `teams/${teamId}/equipment/item-${i}`, data: { name, nameKey: name, holderUid, holderName: holderUid ? `検証メンバー${holderUid === admin.uid ? '000' : '001'}` : null, updatedAt: new Date() } }
      yield { path: `teams/${teamId}/equipmentNames/${name}`, data: { itemId: `item-${i}` } }
    }
    for (let i = 0; i < options.events; i++) {
      yield { path: `teams/${teamId}/events/event-${i}`, data: { title: `検証予定${i.toString().padStart(4, '0')}`, typeId: 'practice', startAt: new Date(Date.now() + 86400000 + i * 3600000), place: '検証会場', attendance: Object.fromEntries(memberIds.map((uid) => [uid, 'absent'])), createdBy: admin.uid, updatedAt: new Date() } }
      if (i < (options.noteEvents ?? options.events)) for (let n = 0; n < options.notesPerEvent; n++) yield { path: `teams/${teamId}/events/event-${i}/notes/note-${n}`, data: noteData(memberIds[n % memberIds.length], n, `検証メンバー${(n % memberIds.length).toString().padStart(3, '0')}`) }
    }
  }
  const seededDocuments = await writeScaleDocuments(documents(), endpoint, onProgress)
  return { ...endpoint, teamId, controlTeamId, options, admin, member, memberIds, seededDocuments, seedMs: performance.now() - start }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preset = process.argv[2] ?? 'large'
  if (!(preset in presets)) throw new Error('Usage: node scripts/seed-scale.ts demo|large [output.json]')
  const fixture = await seedScale(presets[preset as keyof typeof presets], (n) => { if (n % 10000 === 0) console.error(`Seeded ${n} local documents`) })
  const output = process.argv[3] ?? `.scale-artifacts/${preset}.json`
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(fixture, null, 2))
  console.log(JSON.stringify({ fixture: output, documents: fixture.seededDocuments, seedMs: Math.round(fixture.seedMs), project: fixture.projectId }))
}
