import { eventTypesError } from '../../lib/eventTypes'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  onSnapshot,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase/firestore'
import { equipmentNameError, equipmentNameKey } from '../../lib/equipment'
import { generateJoinCode, normalizeJoinCode } from '../../lib/joinCode'
import { isStrongPassword } from '../../lib/password'
import type { EquipmentItem, EventInput, EventNote, Member, Team, TeamEvent, UserProfile } from '../../types'
import { RepositoryError, type Repository, type Unsubscribe } from '../repository'
import { repositoryError } from './errors'

const requiredText = (value: string, max: number) => {
  const text = value.trim()
  if (!text || text.length > max) throw new RepositoryError(`1〜${max}文字で入力してください。`)
  return text
}
const asDate = (value: Timestamp): Date => value?.toDate() ?? new Date()
const profileFrom = (s: DocumentSnapshot): UserProfile | null =>
  s.exists() ? { uid: s.id, displayName: s.data().displayName, teamId: s.data().teamId } : null
const memberFrom = (s: DocumentSnapshot): Member => ({
  uid: s.id,
  displayName: s.data()!.displayName,
  role: s.data()!.role,
  joinedAt: asDate(s.data()!.joinedAt),
})
const teamFrom = (s: DocumentSnapshot): Team | null =>
  s.exists()
    ? {
        id: s.id,
        name: s.data().name,
        createdBy: s.data().createdBy,
        createdAt: asDate(s.data().createdAt),
        settings: s.data().settings,
      }
    : null
const eventFrom = (s: DocumentSnapshot): TeamEvent => {
  const d = s.data()!
  return {
    id: s.id,
    title: d.title,
    typeId: d.typeId,
    startAt: asDate(d.startAt),
    place: d.place,
    attendance: d.attendance,
    createdBy: d.createdBy,
    updatedAt: asDate(d.updatedAt),
  }
}
const noteFrom = (s: DocumentSnapshot): EventNote => {
  const d = s.data()!
  return { id: s.id, authorUid: d.authorUid, authorName: d.authorName, body: d.body, createdAt: asDate(d.createdAt) }
}
const itemFrom = (s: DocumentSnapshot): EquipmentItem => {
  const d = s.data()!
  return { id: s.id, name: d.name, holderUid: d.holderUid, holderName: d.holderName, updatedAt: asDate(d.updatedAt) }
}

class ChangedPossession extends Error {}

export function createFirestoreRepository(auth: Auth, db: Firestore): Repository {
  const errors = new Set<(error: RepositoryError) => void>()
  const report = (e: unknown) => errors.forEach((cb) => cb(repositoryError(e)))
  const safe =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args)
      } catch (e) {
        throw repositoryError(e)
      }
    }
  const uid = () => {
    if (!auth.currentUser) throw new RepositoryError('ログインしてください。')
    return auth.currentUser.uid
  }
  const teamRef = (t: string) => doc(db, 'teams', t)
  const memberRef = (t: string, u: string) => doc(db, 'teams', t, 'members', u)
  const eventRef = (t: string, e: string) => doc(db, 'teams', t, 'events', e)
  const itemRef = (t: string, i: string) => doc(db, 'teams', t, 'equipment', i)
  const nameRef = (t: string, key: string) => doc(db, 'teams', t, 'equipmentNames', key)
  const privateRef = (t: string) => doc(db, 'teams', t, 'private', 'joinCode')
  const userRef = (u: string) => doc(db, 'users', u)
  const codeRef = (code: string) => doc(db, 'joinCodes', code)
  async function ensureProfile(user: User) {
    await runTransaction(db, async (tx) => {
      const ref = userRef(user.uid),
        profile = await tx.get(ref)
      if (!profile.exists()) tx.set(ref, { displayName: user.displayName || 'メンバー', teamId: null })
    })
  }
  function watchDoc<T>(ref: ReturnType<typeof doc>, map: (s: DocumentSnapshot) => T, cb: (data: T) => void, empty: T) {
    return onSnapshot(
      ref,
      (s) => cb(map(s)),
      (e) => {
        report(e)
        cb(empty)
      },
    )
  }
  function watchList<T>(q: Query<DocumentData>, map: (s: DocumentSnapshot) => T, cb: (data: T[]) => void) {
    return onSnapshot(
      q,
      (s) => cb(s.docs.map(map)),
      (e) => {
        report(e)
        cb([])
      },
    )
  }
  async function requireMember(t: string) {
    const m = await getDoc(memberRef(t, uid()))
    if (!m.exists()) throw new RepositoryError('このチームのメンバーではありません。')
    return m.data()
  }
  async function ensureEditor(t: string) {
    const [m, team] = await Promise.all([requireMember(t), getDoc(teamRef(t))])
    if (m.role !== 'admin' && team.data()?.settings.eventEditPolicy !== 'all')
      throw new RepositoryError('予定を編集できるのは管理者のみです。')
    return team.data()!
  }
  const eventData = (input: EventInput, team: DocumentData) => {
    if (!Number.isFinite(input.startAt.getTime())) throw new RepositoryError('日付と時刻を確認してください。')
    if (!team.settings.eventTypes.some((t: { id: string }) => t.id === input.typeId))
      throw new RepositoryError('予定の種類を選択してください。')
    return {
      title: requiredText(input.title, 100),
      typeId: input.typeId,
      startAt: Timestamp.fromDate(input.startAt),
      place: input.place ? requiredText(input.place, 200) : null,
      updatedAt: serverTimestamp(),
    }
  }
  async function changeHolder(
    t: string,
    i: string,
    operation: 'hold' | 'release' | 'force',
    expectedHolderUid?: string,
  ) {
    const actorUid = uid()
    await runTransaction(db, async (tx) => {
      const ref = itemRef(t, i),
        item = await tx.get(ref)
      if (!item.exists()) throw new RepositoryError('用具が見つかりません。')
      const d = item.data(),
        actor = await tx.get(memberRef(t, actorUid))
      if (!actor.exists()) throw new RepositoryError('このチームのメンバーではありません。')
      if (expectedHolderUid !== undefined && d.holderUid !== expectedHolderUid)
        throw new RepositoryError('持ち主が変わりました。最新の状態を確認してください。')
      if (operation === 'hold' && d.holderUid) throw new RepositoryError('この用具はすでに持たれています。')
      if (operation === 'release' && d.holderUid !== actorUid) throw new RepositoryError('自分の用具のみ手放せます。')
      if (operation === 'force' && actor.data().role !== 'admin') throw new RepositoryError('管理者のみ操作できます。')
      if (operation !== 'hold' && !d.holderUid) return
      const holderUid = operation === 'hold' ? actorUid : d.holderUid
      const holder = holderUid === actorUid ? actor : await tx.get(memberRef(t, holderUid))
      if (!holder.exists()) throw new RepositoryError('持ち主が見つかりません。')
      tx.update(holder.ref, {
        heldCount: holder.data().heldCount + (operation === 'hold' ? 1 : -1),
        equipmentChangeId: i,
      })
      tx.update(ref, {
        holderUid: operation === 'hold' ? actorUid : null,
        holderName: operation === 'hold' ? actor.data().displayName : null,
        updatedAt: serverTimestamp(),
      })
    })
  }
  async function detach(t: string, target: string) {
    const [teamBefore, members] = await Promise.all([
      getDoc(teamRef(t)),
      getDocs(collection(db, 'teams', t, 'members')),
    ])
    if (
      teamBefore.data()?.adminUid === target &&
      !members.docs.some((m) => m.id !== target && m.data().role === 'admin')
    ) {
      throw new RepositoryError('最後の管理者はチームを離れられません。')
    }
    // Each release updates a rule-verified possession counter. Membership is removed only at zero.
    const items = await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', target)))
    for (const item of items.docs) await changeHolder(t, item.id, target === uid() ? 'release' : 'force')
    await runTransaction(db, async (tx) => {
      const team = await tx.get(teamRef(t)),
        member = await tx.get(memberRef(t, target))
      if (!member.exists()) throw new RepositoryError('メンバーが見つかりません。')
      if (member.data().heldCount !== 0)
        throw new RepositoryError('用具の状態が変わりました。再取得してやり直してください。')
      if (team.data()!.adminUid === target) {
        const other = members.docs.find((m) => m.id !== target && m.data().role === 'admin')
        if (!other) throw new RepositoryError('最後の管理者はチームを離れられません。')
        tx.update(team.ref, { adminUid: other.id })
      }
      tx.delete(member.ref)
      tx.update(userRef(target), { teamId: null })
    })
  }
  const repository: Repository = {
    onError(cb) {
      errors.add(cb)
      return () => {
        errors.delete(cb)
      }
    },
    auth: {
      onAuthStateChanged(cb) {
        let active = true,
          generation = 0
        const off = onAuthStateChanged(
          auth,
          async (user) => {
            const revision = ++generation
            try {
              if (user) await ensureProfile(user)
            } catch (e) {
              report(e)
            }
            if (active && revision === generation) cb(user ? { uid: user.uid, email: user.email || '' } : null)
          },
          report,
        )
        return () => {
          active = false
          off()
        }
      },
      signUp: safe(async ({ email, password, displayName }) => {
        const name = requiredText(displayName, 40)
        if (!isStrongPassword(password)) throw new RepositoryError('パスワードの条件を満たしてください。')
        await setPersistence(auth, browserLocalPersistence)
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(user, { displayName: name })
        await ensureProfile(user)
        await updateDoc(userRef(user.uid), { displayName: name })
      }),
      signIn: safe(async (email, password) => {
        await setPersistence(auth, browserLocalPersistence)
        const { user } = await signInWithEmailAndPassword(auth, email.trim(), password)
        await ensureProfile(user)
      }),
      signOut: safe(() => signOut(auth)),
      sendPasswordReset: safe((email) => sendPasswordResetEmail(auth, email.trim())),
    },
    users: {
      subscribeProfile(u, cb) {
        return watchDoc(userRef(u), profileFrom, cb, null)
      },
      updateDisplayName: safe(async (displayName) => {
        const u = uid(),
          name = requiredText(displayName, 40)
        for (let attempt = 0; attempt < 4; attempt++) {
          const profile = await getDoc(userRef(u))
          const t = profile.data()?.teamId as string | null
          const items = t
            ? await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', u)))
            : null
          try {
            await runTransaction(db, async (tx) => {
              const current = await tx.get(userRef(u))
              if (current.data()?.teamId !== t) throw new ChangedPossession()
              const member = t ? await tx.get(memberRef(t, u)) : null
              const held = await Promise.all((items?.docs ?? []).map((item) => tx.get(item.ref)))
              if (
                t &&
                (!member?.exists() ||
                  member.data().heldCount !== held.length ||
                  held.some((item) => !item.exists() || item.data().holderUid !== u))
              )
                throw new ChangedPossession()
              tx.update(current.ref, { displayName: name })
              if (member) tx.update(member.ref, { displayName: name })
              held.forEach((item) => tx.update(item.ref, { holderName: name, updatedAt: serverTimestamp() }))
            })
            return
          } catch (error) {
            if (!(error instanceof ChangedPossession)) throw error
          }
        }
        throw new RepositoryError('用具の状態が変わりました。再取得して名前を保存してください。')
      }),
    },
    teams: {
      subscribeJoinCode(t, cb) {
        return watchDoc(privateRef(t), (s) => (s.exists() ? (s.data().code as string) : null), cb, null)
      },
      create: safe(async (name) => {
        const u = uid(),
          nameValue = requiredText(name, 60),
          ref = doc(collection(db, 'teams'))
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateJoinCode()
          const created = await runTransaction(db, async (tx) => {
            const [profile, existing] = await Promise.all([tx.get(userRef(u)), tx.get(codeRef(code))])
            if (profile.data()?.teamId !== null) throw new RepositoryError('すでにチームに参加しています。')
            if (existing.exists()) return false
            tx.set(ref, {
              name: nameValue,
              createdBy: u,
              adminUid: u,
              createdAt: serverTimestamp(),
              settings: {
                eventEditPolicy: 'admins',
                eventTypes: [
                  { id: 'practice', label: '練習', color: '#2563eb' },
                  { id: 'match', label: '試合', color: '#e8590c' },
                ],
              },
            })
            tx.set(memberRef(ref.id, u), {
              displayName: profile.data()!.displayName,
              role: 'admin',
              joinedAt: serverTimestamp(),
              joinCode: '',
              heldCount: 0,
              equipmentChangeId: '',
            })
            tx.set(privateRef(ref.id), { code })
            tx.set(codeRef(code), { teamId: ref.id, createdAt: serverTimestamp() })
            tx.update(userRef(u), { teamId: ref.id })
            return true
          })
          if (created) return ref.id
        }
        throw new RepositoryError('コードを発行できませんでした。もう一度お試しください。')
      }),
      join: safe(async (codeInput) => {
        const code = normalizeJoinCode(codeInput),
          u = uid()
        if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code))
          throw new RepositoryError('参加コードを確認してください。')
        return runTransaction(db, async (tx) => {
          const [profile, join] = await Promise.all([tx.get(userRef(u)), tx.get(codeRef(code))])
          if (!join.exists()) throw new RepositoryError('参加コードが正しくありません。')
          if (profile.data()?.teamId !== null) throw new RepositoryError('すでにチームに参加しています。')
          const t = join.data().teamId as string
          tx.set(memberRef(t, u), {
            displayName: profile.data()!.displayName,
            role: 'member',
            joinedAt: serverTimestamp(),
            joinCode: code,
            heldCount: 0,
            equipmentChangeId: '',
          })
          tx.update(profile.ref, { teamId: t })
          return t
        })
      }),
      subscribe(t, cb) {
        return watchDoc(teamRef(t), teamFrom, cb, null)
      },
      subscribeMembers(t, cb) {
        return watchList(query(collection(db, 'teams', t, 'members')), memberFrom, cb)
      },
      rename: safe(async (t, name) => updateDoc(teamRef(t), { name: requiredText(name, 60) })),
      updateSettings: safe(async (t, settings) => {
        await runTransaction(db, async (tx) => {
          const team = await tx.get(teamRef(t)),
            next = { ...team.data()!.settings, ...settings }
          const validation = eventTypesError(next.eventTypes)
          if (validation) throw new RepositoryError(validation)
          tx.update(team.ref, { settings: next })
        })
      }),
      setRole: safe(async (t, target, role) => {
        const members = await getDocs(collection(db, 'teams', t, 'members'))
        await runTransaction(db, async (tx) => {
          const team = await tx.get(teamRef(t)),
            m = await tx.get(memberRef(t, target))
          if (!m.exists()) throw new RepositoryError('メンバーが見つかりません。')
          if (team.data()!.adminUid === target && role === 'member') {
            const next = members.docs.find((x) => x.id !== target && x.data().role === 'admin')
            if (!next) throw new RepositoryError('最後の管理者は解除できません。')
            tx.update(team.ref, { adminUid: next.id })
          }
          tx.update(m.ref, { role })
        })
      }),
      leave: safe((t) => detach(t, uid())),
      removeMember: safe(async (t, target) => {
        if (target === uid()) throw new RepositoryError('自分を削除する場合は「チームを離れる」を使ってください。')
        if ((await requireMember(t)).role !== 'admin') throw new RepositoryError('管理者のみ操作できます。')
        await detach(t, target)
      }),
      getJoinCode: safe(async (t) => {
        const s = await getDoc(privateRef(t))
        return s.data()!.code as string
      }),
      regenerateJoinCode: safe(async (t) => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateJoinCode()
          const ok = await runTransaction(db, async (tx) => {
            const [current, candidate] = await Promise.all([tx.get(privateRef(t)), tx.get(codeRef(code))])
            if (candidate.exists()) return false
            tx.delete(codeRef(current.data()!.code))
            tx.set(codeRef(code), { teamId: t, createdAt: serverTimestamp() })
            tx.set(privateRef(t), { code })
            return true
          })
          if (ok) return code
        }
        throw new RepositoryError('コードを発行できませんでした。')
      }),
    },
    events: {
      subscribeUpcoming(t, cb) {
        let off: Unsubscribe = () => {},
          timer: ReturnType<typeof setTimeout>
        const start = () => {
          off()
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          off = watchList(
            query(
              collection(db, 'teams', t, 'events'),
              where('startAt', '>=', Timestamp.fromDate(today)),
              orderBy('startAt'),
            ),
            eventFrom,
            cb,
          )
          const tomorrow = new Date(today)
          tomorrow.setDate(tomorrow.getDate() + 1)
          timer = setTimeout(start, tomorrow.getTime() - Date.now() + 20)
        }
        start()
        return () => {
          off()
          clearTimeout(timer)
        }
      },
      create: safe(async (t, input, initialNote) => {
        const team = await ensureEditor(t),
          u = uid(),
          ref = doc(collection(db, 'teams', t, 'events')),
          batch = writeBatch(db)
        batch.set(ref, { ...eventData(input, team), attendance: {}, createdBy: u })
        if (initialNote?.trim()) {
          const m = await requireMember(t)
          batch.set(doc(collection(ref, 'notes')), {
            authorUid: u,
            authorName: m.displayName,
            body: requiredText(initialNote, 2000),
            createdAt: serverTimestamp(),
          })
        }
        await batch.commit()
        return ref.id
      }),
      update: safe(async (t, e, input) => {
        const team = await ensureEditor(t)
        await updateDoc(eventRef(t, e), eventData(input, team))
      }),
      remove: safe(async (t, e) => {
        await ensureEditor(t)
        // Remove from the schedule first. New notes are denied once the parent is gone.
        // Cleanup is idempotent and can resume after a connection interruption.
        await deleteDoc(eventRef(t, e))
        while (true) {
          const notes = await getDocs(query(collection(db, 'teams', t, 'events', e, 'notes'), limit(450)))
          if (notes.empty) break
          const batch = writeBatch(db)
          notes.docs.forEach((n) => batch.delete(n.ref))
          await batch.commit()
        }
      }),
      setAttendance: safe(async (t, e, status) => {
        if (!['present', 'absent', 'observe', 'late', 'leave_early'].includes(status))
          throw new RepositoryError('出欠を確認してください。')
        await updateDoc(
          eventRef(t, e),
          new FieldPath('attendance', uid()),
          status === 'present' ? deleteField() : status,
          'updatedAt',
          serverTimestamp(),
        )
      }),
      subscribeNotes(t, e, cb) {
        return watchList(query(collection(db, 'teams', t, 'events', e, 'notes'), orderBy('createdAt')), noteFrom, cb)
      },
      addNote: safe(async (t, e, body) => {
        const m = await requireMember(t)
        await setDoc(doc(collection(db, 'teams', t, 'events', e, 'notes')), {
          authorUid: uid(),
          authorName: m.displayName,
          body: requiredText(body, 2000),
          createdAt: serverTimestamp(),
        })
      }),
      removeNote: safe(async (t, e, n) => deleteDoc(doc(db, 'teams', t, 'events', e, 'notes', n))),
    },
    equipment: {
      subscribe(t, cb) {
        return watchList(query(collection(db, 'teams', t, 'equipment')), itemFrom, cb)
      },
      add: safe(async (t, input) => {
        const name = validName(input.name),
          key = equipmentNameKey(name),
          ref = doc(collection(db, 'teams', t, 'equipment'))
        await runTransaction(db, async (tx) => {
          if ((await tx.get(nameRef(t, key))).exists()) throw new RepositoryError('同じ名前の用具が登録されています。')
          tx.set(ref, { name, nameKey: key, holderUid: null, holderName: null, updatedAt: serverTimestamp() })
          tx.set(nameRef(t, key), { itemId: ref.id })
        })
        return ref.id
      }),
      update: safe(async (t, i, input) => {
        const name = validName(input.name),
          key = equipmentNameKey(name)
        await runTransaction(db, async (tx) => {
          const item = await tx.get(itemRef(t, i)),
            candidate = await tx.get(nameRef(t, key))
          if (!item.exists()) throw new RepositoryError('用具が見つかりません。')
          if (candidate.exists() && candidate.data().itemId !== i)
            throw new RepositoryError('同じ名前の用具が登録されています。')
          if (item.data().nameKey !== key) {
            tx.delete(nameRef(t, item.data().nameKey))
            tx.set(nameRef(t, key), { itemId: i })
          }
          tx.update(item.ref, { name, nameKey: key, updatedAt: serverTimestamp() })
        })
      }),
      remove: safe(async (t, i) => {
        await runTransaction(db, async (tx) => {
          const item = await tx.get(itemRef(t, i))
          if (!item.exists()) throw new RepositoryError('用具が見つかりません。')
          const holder = item.data().holderUid ? await tx.get(memberRef(t, item.data().holderUid)) : null
          if (holder?.exists()) tx.update(holder.ref, { heldCount: holder.data().heldCount - 1, equipmentChangeId: i })
          tx.delete(nameRef(t, item.data().nameKey))
          tx.delete(item.ref)
        })
      }),
      hold: safe((t, i) => changeHolder(t, i, 'hold')),
      release: safe((t, i) => changeHolder(t, i, 'release')),
      forceRelease: safe((t, i, expected) => changeHolder(t, i, 'force', expected)),
    },
  }
  return repository
}
function validName(input: string) {
  const error = equipmentNameError(input)
  if (error) throw new RepositoryError(error)
  return input.normalize('NFKC').trim()
}
