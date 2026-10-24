import { useEffect, useMemo, useState } from 'react'
import { LoginScreen } from '../features/auth/LoginScreen'
import { SignUpScreen } from '../features/auth/SignUpScreen'
import { TeamEntryScreen } from '../features/auth/TeamEntryScreen'
import type { AuthUser, Member, Team, UserProfile } from '../types'
import { SessionContext, useRefresh, useRepository, type Session } from './contexts'
import { MainShell } from './MainShell'
import { useFeedback } from '../components/feedback/context'
import styles from './app.module.css'
import { Splash } from './Splash'
import { useSubscription } from './useSubscription'

/** ログイン状態 → チーム所属 → メイン画面の順に振り分ける */
export function App() {
  const repo = useRepository()
  const [user, setUser] = useState<AuthUser | null>()
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')

  useEffect(() => repo.auth.onAuthStateChanged(setUser), [repo])

  if (user === undefined) return <Splash />
  if (user === null) {
    return authMode === 'login' ? (
      <LoginScreen onSignUp={() => setAuthMode('signup')} />
    ) : (
      <SignUpScreen onLogin={() => setAuthMode('login')} />
    )
  }
  return <SignedIn key={user.uid} user={user} />
}

function SignedIn({ user }: { user: AuthUser }) {
  const repo = useRepository()
  const profile = useSubscription<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), [user.uid])

  const teams = useSubscription<Team[]>((cb) => repo.teams.subscribeMine(cb), [user.uid])
  const [adding, setAdding] = useState(false)
  const { run } = useFeedback()
  if (profile === undefined || teams === undefined) return <Splash />
  if (profile === null) return <ConnectionIssue />
  // 2回目以降のログインでは teamId がわかるので、参加コードの入力は不要
  if (!profile.teamId || adding) return <TeamEntryScreen profile={profile} onDone={profile.teamId ? () => setAdding(false) : undefined} />
  // 対応するリポジトリでチームの切り替え・追加を表示する
  return <>
    {repo.supports?.multipleTeams && <div className={styles.teamSwitcher}>
      <label className="field">
        <span className="label">表示するチーム</span>
        <select className="input" value={profile.teamId} onChange={(e) => run(() => repo.teams.select(e.target.value))}>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button className="btn btn-secondary" onClick={() => setAdding(true)}>チームを追加</button>
    </div>}
    <TeamSession key={profile.teamId} user={user} profile={profile} teamId={profile.teamId} />
  </>
}

function TeamSession({ user, profile, teamId }: { user: AuthUser; profile: UserProfile; teamId: string }) {
  const repo = useRepository()
  const team = useSubscription<Team | null>((cb) => repo.teams.subscribe(teamId, cb), [teamId])
  const members = useSubscription<Member[]>((cb) => repo.teams.subscribeMembers(teamId, cb), [teamId])

  const session = useMemo<Session | null>(() => {
    const me = members?.find((m) => m.uid === user.uid)
    if (!team || !members || !me) return null
    const isAdmin = me.role === 'admin'
    return {
      user,
      profile,
      team,
      members,
      me,
      isAdmin,
      canEditEvents: isAdmin || team.settings.eventEditPolicy === 'all',
    }
  }, [user, profile, team, members])

  if (team === undefined || members === undefined) return <Splash />
  if (team?.deleting) return <TeamDeletion teamId={teamId} canResume={team.deletionUid === user.uid} />
  if (!session) return <ConnectionIssue />
  return (
    <SessionContext.Provider value={session}>
      <MainShell />
    </SessionContext.Provider>
  )
}

function ConnectionIssue() {
  const repo = useRepository()
  const { refresh } = useRefresh()
  return (
    <main className="card" role="alert" style={{ margin: '24px', padding: '24px' }}>
      <h1>データを読み込めませんでした</h1>
      <p>通信状態とチームへの所属を確認して、再取得してください。</p>
      <button className="btn btn-primary" onClick={refresh}>
        再取得
      </button>
      <button
        className="btn btn-secondary"
        onClick={() => {
          void repo.auth.signOut()
        }}
      >
        ログアウト
      </button>
    </main>
  )
}

function TeamDeletion({ teamId, canResume }: { teamId: string; canResume: boolean }) {
  const repo = useRepository()
  const { run } = useFeedback()
  const [busy, setBusy] = useState(false)
  return (
    <main className="card" style={{ margin: 24, padding: 24 }}>
      <h1>チームを削除中です</h1>
      <p>削除を開始した管理者は、通信状態を確認して削除を再開できます。他のチームには影響しません。</p>
      {canResume && <button className="btn btn-danger" disabled={busy} onClick={async () => {
        setBusy(true)
        await run(() => repo.teams.remove(teamId), 'チームを削除しました')
        setBusy(false)
      }}>削除を再開</button>}
      <button className="btn btn-secondary" onClick={() => run(() => repo.auth.signOut())}>ログアウト</button>
    </main>
  )
}
