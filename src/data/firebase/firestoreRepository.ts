import { MAX_STORED_ATTENDANCE, ATTENDANCE_LIMIT_MESSAGE } from '../../lib/attendance'
import { deletionRun, type DeletionProgress } from '../../lib/deletion'
import { placesError } from '../../lib/places'
import { eventTypesError } from '../../lib/eventTypes'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
  type UserCredential,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getCountFromServer,
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
  type QuerySnapshot,
} from 'firebase/firestore'
import { equipmentNameError, equipmentNameKey } from '../../lib/equipment'
import { generateJoinCode, normalizeJoinCode } from '../../lib/joinCode'
import { isStrongPassword } from '../../lib/password'
import { MAX_WEEKLY_EVENTS } from '../../lib/weekly'
import type { AuthUser, EquipmentItem, EventInput, EventNote, Member, Team, TeamEvent, UserProfile } from '../../types'
import { RepositoryError, type Repository, type Unsubscribe } from '../repository'
import { repositoryError } from './errors'
import { recoveringSubscription } from './recoveringSubscription'

const requiredText = (value: string, max: number) => {
  const text = value.trim()
  if (!text || text.length > max) throw new RepositoryError(`1〜${max}文字で入力してください。`)
  return text
}
const asDate = (value: Timestamp): Date => value?.toDate() ?? new Date()
// 旧形式のプロフィールは既存の単一所属を失わずに読み込む。
const teamIdsFrom = (data: DocumentData): string[] => data.teamIds ?? (data.teamId ? [data.teamId] : [])
const profileFrom = (s: DocumentSnapshot): UserProfile | null =>
  s.exists()
    ? { deletingAccount: s.data().deletingAccount === true, uid: s.id, displayName: s.data().displayName, teamIds: teamIdsFrom(s.data()), teamId: s.data().teamId }
    : null
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
        deleting: !!s.data().deletionUid,
        deletionUid: s.data().deletionUid,
      }
    : null
const eventFrom = (s: DocumentSnapshot): TeamEvent => {
  const d = s.data()!
  return {
    id: s.id,
    deleting: !!d.deleting,
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

const authUserFrom = (user: User): AuthUser => ({ uid: user.uid, email: user.email || '', emailVerified: user.emailVerified, providers: user.providerData.map((p) => p.providerId) })

// Google のログイン画面（ポップアップ）。リダイレクト方式は iPhone の Safari でストレージの分離により失敗することがある（#31）
const googleSignInWithPopup = (auth: Auth) => {
  const provider = new GoogleAuthProvider()
  // 複数の Google アカウントを使っている人が、毎回アカウントを選べるようにする
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(auth, provider)
}
// ログイン画面を閉じた・もう一度押して前の画面が取り消された場合は、エラーとして扱わない
const GOOGLE_CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']

export function createFirestoreRepository(
  auth: Auth,
  db: Firestore,
  // テストでは、ポップアップの代わりにエミュレータ用の資格情報でログインする
  { googleSignIn = googleSignInWithPopup, googleReauthenticate = (user) => reauthenticateWithPopup(user, new GoogleAuthProvider()) }: { googleSignIn?: (auth: Auth) => Promise<UserCredential>; googleReauthenticate?: (user: User) => Promise<UserCredential> } = {},
): Repository {
  // reload() では onAuthStateChanged が発火しないため、確認状態の更新はここから通知する
  auth.languageCode = 'ja'
  let accountDeletionJob: Promise<void> | undefined
  const authListeners = new Set<(user: AuthUser | null) => void>()
  const deletionStates = new Map<string, DeletionProgress>()
  const deletionListeners = new Map<string, Set<(p: DeletionProgress | null) => void>>()
  const deletionControls = new Map<string, ReturnType<typeof deletionRun>>()
  const deletionJobs = new Map<string, Promise<void>>()
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
      if (!profile.exists()) tx.set(ref, { displayName: user.displayName || 'メンバー', teamId: null, teamIds: [] })
      else if (!profile.data().teamIds) tx.update(ref, { teamIds: teamIdsFrom(profile.data()) })
    })
  }
  // 同じチームの一覧・メンバー・予定が同時に拒否されても、修復は一度にまとめる。
  const membershipRepairs = new Map<string, Promise<boolean>>()
  // 異なる無効IDも同じプロフィールを書き換える。ルールは最新のresourceで
  // 対象1件だけの除去を検証するため、並行書き込みによる拒否を避ける。
  let membershipRepairQueue: Promise<unknown> = Promise.resolve()
  const repairedMemberships = new Set<string>()
  function repairMembership(t: string): Promise<boolean> {
    const user = auth.currentUser
    if (!user?.emailVerified) return Promise.resolve(false)
    const key = `${user.uid}/${t}`
    const pending = membershipRepairs.get(key)
    if (pending) return pending
    const task = membershipRepairQueue.then(() => runTransaction(db, async (tx) => {
      if (auth.currentUser !== user) return false
      const profile = await tx.get(userRef(user.uid))
      if (!profile.exists()) return false
      const data = profile.data(), ids = teamIdsFrom(data)
      if (!ids.includes(t)) return repairedMemberships.has(key)
      const remaining = ids.filter((id) => id !== t)
      // キャッシュの欠落・permission-deniedだけでは削除を確定しない。
      // removal() がサーバー上の本人メンバーの不存在を検証し、有効な所属の削除を拒否する。
      tx.update(profile.ref, {
        teamIds: remaining,
        teamId: data.teamId === t ? remaining[0] ?? null : data.teamId,
        membershipChangeTeamId: t,
      })
      return true
    })).then((repaired) => {
      if (repaired) repairedMemberships.add(key)
      return repaired
    }).catch(() => false)
    membershipRepairQueue = task
    membershipRepairs.set(key, task)
    void task.finally(() => membershipRepairs.delete(key))
    return task
  }
  function watchDoc<T>(ref: ReturnType<typeof doc>, map: (s: DocumentSnapshot) => T, cb: (data: T) => void, empty: T) {
    let active = true
    const parts = ref.path.split('/')
    const teamId = parts[0] === 'teams' ? parts[1] : undefined
    const off = recoveringSubscription<DocumentSnapshot>(
      auth,
      (next, error) => onSnapshot(ref, next, error),
      (s) => cb(map(s)),
      (e) => {
        void (async () => {
          const repaired = teamId && (e as { code?: string }).code === 'permission-denied'
            ? await repairMembership(teamId) : false
          if (!active) return
          if (!repaired) report(e)
          cb(empty)
        })()
      },
    )
    return () => { active = false; off() }
  }
  function watchList<T>(q: Query<DocumentData>, map: (s: DocumentSnapshot) => T, cb: (data: T[]) => void, teamId: string) {
    let active = true
    const off = recoveringSubscription<QuerySnapshot<DocumentData>>(
      auth,
      (next, error) => onSnapshot(q, next, error),
      (s) => cb(s.docs.map(map)),
      (e) => {
        void (async () => {
          const repaired = (e as { code?: string }).code === 'permission-denied'
            ? await repairMembership(teamId) : false
          if (!active) return
          if (!repaired) report(e)
          cb([])
        })()
      },
    )
    return () => { active = false; off() }
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
    if (target !== uid()) await repository.teams.select(t)
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
        member = await tx.get(memberRef(t, target)),
        profile = await tx.get(userRef(target))
      if (!member.exists()) throw new RepositoryError('メンバーが見つかりません。')
      if (member.data().heldCount !== 0)
        throw new RepositoryError('用具の状態が変わりました。再取得してやり直してください。')
      if (team.data()!.adminUid === target) {
        const other = members.docs.find((m) => m.id !== target && m.data().role === 'admin')
        if (!other) throw new RepositoryError('最後の管理者はチームを離れられません。')
        tx.update(team.ref, { adminUid: other.id })
      }
      tx.delete(member.ref)
      const remaining = teamIdsFrom(profile.data()!).filter((id) => id !== t)
      tx.update(profile.ref, {
        teamIds: remaining,
        teamId: profile.data()!.teamId === t ? remaining[0] ?? null : profile.data()!.teamId,
        membershipChangeTeamId: t,
      })
    })
  }
  const repository: Repository = {
    supports: { multipleTeams: true, deleteTeam: true },
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
            if (active && revision === generation) cb(user ? authUserFrom(user) : null)
          },
          report,
        )
        authListeners.add(cb)
        return () => {
          active = false
          authListeners.delete(cb)
          off()
        }
      },
      signUp: safe(async ({ email, password, displayName }) => {
        const name = requiredText(displayName, 40)
        if (!isStrongPassword(password)) throw new RepositoryError('パスワードの条件を満たしてください。')
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(user, { displayName: name })
        await ensureProfile(user)
        await updateDoc(userRef(user.uid), { displayName: name })
        // 登録したメールアドレスが本人のものか確認する。確認が済むまでチームの操作はできない（#39）
        await sendEmailVerification(user)
      }),
      sendEmailVerification: safe(async () => {
        if (!auth.currentUser) throw new RepositoryError('ログインしてください。')
        await sendEmailVerification(auth.currentUser)
      }),
      reloadUser: safe(async () => {
        const user = auth.currentUser
        if (!user) return
        await user.reload()
        // セキュリティルールが参照する email_verified を、新しいトークンに反映する
        await user.getIdToken(true)
        authListeners.forEach((cb) => cb(authUserFrom(user)))
      }),
      signIn: safe(async (email, password) => {
        const { user } = await signInWithEmailAndPassword(auth, email.trim(), password)
        await ensureProfile(user)
      }),
      signInWithGoogle: safe(async () => {
        let credential: UserCredential
        try {
          // ポップアップがブロックされないよう、ボタンを押した直後に開く（setPersistence などの await を先に挟まない）。
          // ログイン状態は getAuth の既定（IndexedDB）で保存される
          credential = await googleSignIn(auth)
        } catch (e) {
          if (e instanceof FirebaseError && GOOGLE_CANCELLED.includes(e.code)) return
          throw e
        }
        // 初回はプロフィールを作る。表示名の初期値は Google アカウントの名前（チームでの名前は参加・作成時に入力する）
        await ensureProfile(credential.user)
      }),
      signOut: safe(() => signOut(auth)),
      sendPasswordReset: safe((email) => sendPasswordResetEmail(auth, email.trim())),
      cancelAccountDeletion: safe(async () => {
        if (accountDeletionJob) throw new RepositoryError('削除処理が終わるまでお待ちください。')
        await updateDoc(userRef(uid()), { deletingAccount: false })
      }),
      deleteAccount: safe(async ({ confirmation, password }) => {
        if (confirmation !== '削除') throw new RepositoryError('確認欄に「削除」と入力してください。')
        const user = auth.currentUser
        if (!user) throw new RepositoryError('ログインしてください。')
        if (accountDeletionJob) throw new RepositoryError('アカウント削除を実行中です。')
        // Google のポップアップは、タップした直後に開始する。
        const reauth = password && user.providerData.some((p) => p.providerId === 'password')
          ? reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password))
          : user.providerData.some((p) => p.providerId === 'google.com')
            ? googleReauthenticate(user)
            : Promise.reject(new RepositoryError('現在のパスワードを入力してください。'))
        const task = (async () => {
          await reauth
          const assertUser = () => { if (auth.currentUser !== user) throw new RepositoryError('ログイン状態が変わりました。') }
          assertUser()
          const profile = await getDoc(userRef(user.uid))
          if (profile.exists()) {
            const ids = teamIdsFrom(profile.data())
            // 全チームを先に確認し、最後の管理者なら他チームからも離脱しない。
            for (const t of ids) {
              let team: DocumentSnapshot
              try { team = await getDoc(teamRef(t)) } catch (error) {
                if ((error as { code?: string }).code === 'permission-denied' && await repairMembership(t)) continue
                throw error
              }
              if (!team.exists()) throw new RepositoryError('所属チームの状態を確認できません。再取得してください。')
              const members = await getDocs(collection(db, 'teams', t, 'members'))
              const own = members.docs.find((m) => m.id === user.uid)
              if (own?.data().role === 'admin' && !members.docs.some((m) => m.id !== user.uid && m.data().role === 'admin')) {
                throw new RepositoryError('最後の管理者になっているチームがあります。他の管理者を任命するか、チームを削除してからやり直してください。')
              }
            }
            assertUser()
            await updateDoc(profile.ref, { deletingAccount: true })
            // 別タブの参加・用具取得をルールで止めてから、最新の所属を順に解除する。
            const latest = await getDoc(profile.ref)
            for (const t of teamIdsFrom(latest.data()!)) {
              assertUser()
              try { await detach(t, user.uid) } catch (error) {
                if ((error as { code?: string }).code === 'permission-denied' && await repairMembership(t)) continue
                throw error
              }
            }
            assertUser()
            // ルールでも未所属・削除中・直近の本人認証を確認する。
            await deleteDoc(profile.ref)
          }
          assertUser()
          await deleteUser(user)
        })()
        accountDeletionJob = task
        try { await task } finally { accountDeletionJob = undefined }
      }),
    },
    users: {
      updateAccountName: safe(async (displayName) => {
        const user = auth.currentUser
        if (!user) throw new RepositoryError('ログインしてください。')
        // アプリでの正本は users.displayName。チーム名・Google 側の名前は変えない。
        await updateDoc(userRef(user.uid), { displayName: requiredText(displayName, 40) })
      }),
      subscribeProfile(u, cb) {
        return watchDoc(userRef(u), profileFrom, cb, null)
      },
      updateDisplayName: safe(async (teamId, displayName) => {
        const u = uid(),
          name = requiredText(displayName, 40)
        const t = teamId
        await requireMember(t)
        for (let attempt = 0; attempt < 4; attempt++) {
          const items = await getDocs(query(collection(db, 'teams', t, 'equipment'), where('holderUid', '==', u)))
          try {
            await runTransaction(db, async (tx) => {
              const member = await tx.get(memberRef(t, u))
              const held = await Promise.all(items.docs.map((item) => tx.get(item.ref)))
              if (!member.exists() || member.data().heldCount !== held.length ||
                held.some((item) => !item.exists() || item.data().holderUid !== u)) throw new ChangedPossession()
              tx.update(member.ref, { displayName: name })
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
      estimateDeletion: safe(async (t) => {
        const counts = await Promise.all(['events', 'equipment', 'members'].map(async (path) => (await getCountFromServer(collection(db, 'teams', t, path))).data().count))
        return { events: counts[0], equipment: counts[1], members: counts[2], minimumDocuments: counts.reduce((a, b) => a + b, 1) }
      }),
      subscribeDeletionProgress(t, cb) {
        const listeners = deletionListeners.get(t) ?? new Set()
        deletionListeners.set(t, listeners); listeners.add(cb); cb(deletionStates.get(t) ?? null)
        return () => { listeners.delete(cb); if (!listeners.size) deletionListeners.delete(t) }
      },
      pauseDeletion(t) { deletionControls.get(t)?.pause() },
      remove: safe(async (t, options) => {
        const existing = deletionJobs.get(t)
        if (existing) return existing
        const control = deletionRun((state) => {
          deletionStates.set(t, state); deletionListeners.get(t)?.forEach((cb) => cb(state))
        }, options?.maxDeletes)
        deletionControls.set(t, control)
        const task = (async () => {
          const actor = uid()
          await repository.teams.select(t)
          await runTransaction(db, async (tx) => {
            const team = await tx.get(teamRef(t))
            if (!team.exists()) return
            if (team.data().deletionUid) {
              if (team.data().deletionUid !== actor) throw new RepositoryError('削除を開始した管理者が再実行してください。')
            } else tx.update(team.ref, { deletionUid: actor })
          })
          // 親の予定を最後まで残し、途中失敗しても notes の走査先を失わない。
          const clear = async (segments: string[]) => {
            while (true) {
              control.check()
              const page = await getDocs(query(collection(db, segments.join('/')), limit(Math.min(100, control.remaining()))))
              if (page.empty) break
              // オフライン書込キューへ積まず、quotaエラーでアプリ側の処理を停止する。
              await runTransaction(db, async (tx) => { page.docs.forEach((entry) => tx.delete(entry.ref)) }, { maxAttempts: 1 })
              control.completed(page.size, segments.at(-1) === 'notes' ? 'メモ' : '用具名')
            }
          }
          while (true) {
            control.check()
            const events = await getDocs(query(collection(db, 'teams', t, 'events'), limit(50)))
            if (events.empty) break
            for (const event of events.docs) {
              await clear(['teams', t, 'events', event.id, 'notes'])
              control.check()
              await runTransaction(db, async (tx) => { tx.delete(event.ref) }, { maxAttempts: 1 })
              control.completed(1, '予定')
            }
          }
          // 削除中もメンバーは通常どおり使うため、途中で止まっても所持数（heldCount）が実際の用具と食い違わないよう、
          // 通常の削除と同じく所持数を更新しながら1点ずつ消す
          while (true) {
            control.check(2)
            const items = await getDocs(query(collection(db, 'teams', t, 'equipment'), limit(100)))
            if (items.empty) break
            for (const item of items.docs) {
              // 同時にメンバーが消した用具は飛ばす。それ以外の失敗は削除を止め、再開に任せる（無限に繰り返さない）
              control.check(2)
              await repository.equipment.remove(t, item.id).then(() => control.completed(2, '用具')).catch((error: unknown) => {
                if (!(error instanceof RepositoryError && error.message.includes('見つかりません'))) throw error
              })
            }
          }
          await clear(['teams', t, 'equipmentNames'])
          const code = await getDoc(privateRef(t))
          if (code.exists()) {
            control.check(2)
            await runTransaction(db, async (tx) => { tx.delete(codeRef(code.data().code)); tx.delete(code.ref) }, { maxAttempts: 1 })
            control.completed(2, '参加コード')
          }
          const detachDeleted = async (target: string, final = false) => {
            control.check(final ? 2 : 1)
            await runTransaction(db, async (tx) => {
              const profile = await tx.get(userRef(target))
              if (profile.exists()) {
                const remaining = teamIdsFrom(profile.data()).filter((id) => id !== t)
                tx.update(profile.ref, {
                  teamIds: remaining,
                  teamId: profile.data().teamId === t ? remaining[0] ?? null : profile.data().teamId,
                  membershipChangeTeamId: t,
                })
              }
              tx.delete(memberRef(t, target))
              if (final) tx.delete(teamRef(t))
            }, { maxAttempts: 1 })
            control.completed(final ? 2 : 1, 'メンバー')
          }
          const members = await getDocs(collection(db, 'teams', t, 'members'))
          for (const member of members.docs) if (member.id !== actor) await detachDeleted(member.id)
          // 削除者の所属と親は最後に同時削除し、リロード後も再開できるようにする。
          await detachDeleted(actor, true)
        })()
        deletionJobs.set(t, task)
        try { await task; control.finish('削除が完了しました。') } catch (error) { control.finish(repositoryError(error).message); throw error } finally { deletionJobs.delete(t); deletionControls.delete(t) }
      }),
      subscribeMine(cb) {
        const u = uid()
        let idsKey = ''
        let stops: Unsubscribe[] = []
        let generation = 0
        const off = repository.users.subscribeProfile(u, (profile) => {
          const ids = profile?.teamIds ?? []
          const key = JSON.stringify(ids)
          if (key === idsKey) return
          idsKey = key
          const revision = ++generation
          stops.forEach((stop) => stop())
          stops = []
          const teams = new Map<string, Team>()
          if (!ids.length) cb([])
          for (const id of ids) stops.push(repository.teams.subscribe(id, (team) => {
            if (revision !== generation) return
            if (team) teams.set(id, team)
            else teams.delete(id)
            cb(ids.flatMap((id) => teams.get(id) ? [teams.get(id)!] : []))
          }))
        })
        return () => { ++generation; off(); stops.forEach((stop) => stop()) }
      },
      select: safe(async (t) => {
        // トランザクションは使わない。トランザクションの書き込みは端末内に先に反映されず、プロフィールの購読に届くまで
        // サーバーからの通知を待つため、表示するチームの切り替えが画面に出るのが遅れることがある。
        // 通常の更新なら購読へすぐに反映される。所属していないチームへの切り替えはセキュリティルールが拒否し、
        // そのときは端末内の変更も取り消される（所属と、チームのメンバーであることをルールで確認している）
        await updateDoc(userRef(uid()), { teamId: t })
      }),
      subscribeJoinCode(t, cb) {
        return onSnapshot(
          privateRef(t),
          (s) => cb(s.exists() ? (s.data().code as string) : null),
          (e) => {
            // 設定タブを開いたまま管理者でなくなると、画面が切り替わる前に読み取りが拒否される。
            // 想定内のためエラーとして通知せず、コードがない状態にする（#43）
            if ((e as { code?: string }).code !== 'permission-denied') report(e)
            cb(null)
          },
        )
      },
      create: safe(async (name, displayName) => {
        const u = uid(),
          nameValue = requiredText(name, 60),
          ref = doc(collection(db, 'teams'))
        const memberName = requiredText(displayName, 40)
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateJoinCode()
          const created = await runTransaction(db, async (tx) => {
            const [profile, existing] = await Promise.all([tx.get(userRef(u)), tx.get(codeRef(code))])
            if (teamIdsFrom(profile.data()!).length >= 20) throw new RepositoryError('所属できるチームは20件までです。')
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
              displayName: memberName,
              role: 'admin',
              joinedAt: serverTimestamp(),
              joinCode: '',
              heldCount: 0,
              equipmentChangeId: '',
            })
            tx.set(privateRef(ref.id), { code })
            tx.set(codeRef(code), { teamId: ref.id, createdAt: serverTimestamp() })
            tx.update(userRef(u), { teamId: ref.id, teamIds: [...teamIdsFrom(profile.data()!), ref.id], membershipChangeTeamId: ref.id })
            return true
          })
          if (created) return ref.id
        }
        throw new RepositoryError('コードを発行できませんでした。もう一度お試しください。')
      }),
      join: safe(async (codeInput, displayName) => {
        const code = normalizeJoinCode(codeInput),
          u = uid()
        if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code))
          throw new RepositoryError('参加コードを確認してください。')
        if (!(await getDoc(codeRef(code))).exists()) throw new RepositoryError('参加コードが正しくありません。')
        const memberName = requiredText(displayName, 40)
        return runTransaction(db, async (tx) => {
          const [profile, join] = await Promise.all([tx.get(userRef(u)), tx.get(codeRef(code))])
          if (!join.exists()) throw new RepositoryError('参加コードが正しくありません。')
          if (teamIdsFrom(profile.data()!).length >= 20) throw new RepositoryError('所属できるチームは20件までです。')
          const t = join.data().teamId as string
          if (teamIdsFrom(profile.data()!).includes(t)) throw new RepositoryError('このチームにはすでに参加しています。')
          tx.set(memberRef(t, u), {
            displayName: memberName,
            role: 'member',
            joinedAt: serverTimestamp(),
            joinCode: code,
            heldCount: 0,
            equipmentChangeId: '',
          })
          tx.update(profile.ref, { teamId: t, teamIds: [...teamIdsFrom(profile.data()!), t], membershipChangeTeamId: t })
          return t
        })
      }),
      subscribe(t, cb) {
        return watchDoc(teamRef(t), teamFrom, cb, null)
      },
      subscribeMembers(t, cb) {
        return watchList(query(collection(db, 'teams', t, 'members')), memberFrom, cb, t)
      },
      rename: safe(async (t, name) => updateDoc(teamRef(t), { name: requiredText(name, 60) })),
      updateSettings: safe(async (t, settings) => {
        await runTransaction(db, async (tx) => {
          const team = await tx.get(teamRef(t)),
            next = { ...team.data()!.settings, ...settings, ...(settings.places ? { places: settings.places.map((p) => p.trim()) } : {}) }
          const validation = eventTypesError(next.eventTypes) || placesError(next.places ?? [])
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
      subscribeOne(t, e, cb) {
        return watchDoc(eventRef(t, e), (s) => s.exists() && !s.data().deleting ? eventFrom(s) : null, cb, null)
      },
      subscribeUpcoming(t, cb, pageSize = 20) {
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
              limit(Math.max(1, Math.floor(pageSize)) + 1),
            ),
            eventFrom,
            (events) => cb(events.slice(0, pageSize).filter((event) => !event.deleting), events.length > pageSize),
            t,
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
      createMany: safe(async (t, inputs) => {
        if (inputs.length === 0 || inputs.length > MAX_WEEKLY_EVENTS)
          throw new RepositoryError(`一度に追加できる予定は${MAX_WEEKLY_EVENTS}件までです。`)
        const team = await ensureEditor(t),
          u = uid(),
          batch = writeBatch(db)
        const refs = inputs.map((input) => {
          const ref = doc(collection(db, 'teams', t, 'events'))
          batch.set(ref, { ...eventData(input, team), attendance: {}, createdBy: u })
          return ref
        })
        await batch.commit()
        return refs.map((ref) => ref.id)
      }),
      update: safe(async (t, e, input) => {
        const team = await ensureEditor(t)
        await updateDoc(eventRef(t, e), eventData(input, team))
      }),
      remove: safe(async (t, e) => {
        await ensureEditor(t)
        // 清掃先を失わないよう親を残して非表示・書き込み停止にする。
        // 旧版で親だけ削除済みの場合も、同じIDでメモ清掃を再実行できる。
        const event = await getDoc(eventRef(t, e))
        if (event.exists()) await updateDoc(event.ref, { deleting: true, updatedAt: serverTimestamp() })
        while (true) {
          const notes = await getDocs(query(collection(db, 'teams', t, 'events', e, 'notes'), limit(450)))
          if (notes.empty) break
          const batch = writeBatch(db)
          notes.docs.forEach((n) => batch.delete(n.ref))
          await batch.commit()
        }
        await deleteDoc(eventRef(t, e))
      }),
      setAttendance: safe(async (t, e, status) => {
        if (!['present', 'absent', 'observe', 'late', 'leave_early'].includes(status))
          throw new RepositoryError('出欠を確認してください。')
        const actor = uid()
        await runTransaction(db, async (tx) => {
          const event = await tx.get(eventRef(t, e))
          if (!event.exists()) throw new RepositoryError('予定が見つかりません。')
          const attendance = event.data().attendance as Record<string, string>
          if (status !== 'present' && !(actor in attendance) && Object.keys(attendance).length >= MAX_STORED_ATTENDANCE)
            throw new RepositoryError(ATTENDANCE_LIMIT_MESSAGE)
          tx.update(event.ref, new FieldPath('attendance', actor), status === 'present' ? deleteField() : status, 'updatedAt', serverTimestamp())
        })
      }),
      subscribeNotes(t, e, cb) {
        return watchList(query(collection(db, 'teams', t, 'events', e, 'notes'), orderBy('createdAt')), noteFrom, cb, t)
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
        return watchList(query(collection(db, 'teams', t, 'equipment')), itemFrom, cb, t)
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
