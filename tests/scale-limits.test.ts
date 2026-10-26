import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore'
import { createFirestoreRepository } from '../src/data/firebase/firestoreRepository'
import { localJson, SCALE_PASSWORD, SCALE_PROJECT, seedScale } from '../scripts/seed-scale'
const apps: FirebaseApp[] = []
afterAll(async () => { await Promise.all(apps.map(deleteApp)) })
describe.skipIf(process.env.BUKATSU_SCALE_CHECK !== '1')('attendance limit (#69)', () => {
  it('accepts the 101st non-present answer after a valid team join', async () => {
    const fixture = await seedScale({ members: 100, events: 1, notesPerEvent: 0, equipment: 0 })
    function client(name: string) {
      const app = initializeApp({ projectId: SCALE_PROJECT, apiKey: 'fake-api-key', appId: 'fake-scale-limit' }, name)
      apps.push(app)
      const auth = getAuth(app), db = getFirestore(app), [host, port] = fixture.firestoreHost.split(':')
      connectFirestoreEmulator(db, host, Number(port)); connectAuthEmulator(auth, `http://${fixture.authHost}`, { disableWarnings: true })
      return { auth, db, repo: createFirestoreRepository(auth, db) }
    }
    const admin = client('scale-limit-admin'), newcomer = client('scale-limit-new')
    await admin.repo.auth.signIn(fixture.admin.email, SCALE_PASSWORD)
    await newcomer.repo.auth.signUp({ email: `new-${fixture.teamId}@example.invalid`, password: SCALE_PASSWORD, displayName: '境界確認メンバー' })
    await localJson(`http://${fixture.authHost}/identitytoolkit.googleapis.com/v1/projects/${SCALE_PROJECT}/accounts:update`, { localId: newcomer.auth.currentUser!.uid, emailVerified: true }, true)
    await newcomer.repo.auth.reloadUser()
    await newcomer.repo.teams.join(await admin.repo.teams.getJoinCode(fixture.teamId), '境界確認メンバー')
    expect((await getDocs(collection(admin.db, 'teams', fixture.teamId, 'members'))).size).toBe(101)
    await expect(newcomer.repo.events.setAttendance(fixture.teamId, 'event-0', 'late')).resolves.toBeUndefined()
    expect(Object.keys((await getDoc(doc(admin.db, 'teams', fixture.teamId, 'events', 'event-0'))).data()!.attendance).length).toBe(101)
    await admin.repo.events.setAttendance(fixture.teamId, 'event-0', 'present')
    await expect(newcomer.repo.events.setAttendance(fixture.teamId, 'event-0', 'late')).resolves.toBeUndefined()
    const event = (await getDoc(doc(admin.db, 'teams', fixture.teamId, 'events', 'event-0'))).data()!
    expect(Object.keys(event.attendance).length).toBe(100)
    expect(event.attendance[newcomer.auth.currentUser!.uid]).toBe('late')
    await mkdir('.scale-artifacts', { recursive: true })
    await writeFile('.scale-artifacts/attendance-limit.json', JSON.stringify({ members: 101, storedAnswersBefore: 100, answer101Accepted: true, answerAfterRemovingOneAccepted: true }, null, 2))
  }, 60000)
})
