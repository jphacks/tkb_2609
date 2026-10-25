import { useEffect, useMemo, useState } from 'react'
import { LoginScreen } from '../features/auth/LoginScreen'
import { SignUpScreen } from '../features/auth/SignUpScreen'
import { TeamEntryScreen } from '../features/auth/TeamEntryScreen'
import { VerifyEmailScreen } from '../features/auth/VerifyEmailScreen'
import { LandingScreen } from '../features/landing/LandingScreen'
import { isSharedLink } from '../lib/inAppBrowser'
import type { AuthUser, Member, Team, UserProfile } from '../types'
import { canSwitchTeam, SessionContext, TeamNavigationContext, useRefresh, useRepository, useTeamNavigation, type Session, type TeamNavigation } from './contexts'
import { MainShell, type TabId } from './MainShell'
import { useFeedback } from '../components/feedback/context'
import { Splash } from './Splash'
import styles from './app.module.css'
import { TeamSelect } from './TeamSelect'
import { useSubscription } from './useSubscription'

/** ログイン状態 → チーム所属 → メイン画面の順に振り分ける */
export function App() {
  const repo = useRepository()
  const [user, setUser] = useState<AuthUser | null>()
  // 共有されたリンクから開いたときは、紹介ページを飛ばしてログイン画面から始める（#79）
  const [authMode, setAuthMode] = useState<'landing' | 'login' | 'signup'>(() => (isSharedLink(location.href) ? 'login' : 'landing'))

  useEffect(() => repo.auth.onAuthStateChanged(setUser), [repo])

  if (user === undefined) return <Splash />
  if (user === null) {
    if (authMode === 'landing') {
      return <LandingScreen onSignUp={() => setAuthMode('signup')} onLogin={() => setAuthMode('login')} />
    }
    return authMode === 'login' ? (
      <LoginScreen onSignUp={() => setAuthMode('signup')} onBack={() => setAuthMode('landing')} />
    ) : (
      <SignUpScreen onLogin={() => setAuthMode('login')} onBack={() => setAuthMode('landing')} />
    )
  }
  // メールアドレスを確認するまでは、チームの作成・参加などを始めない（#39）
  if (!user.emailVerified) return <VerifyEmailScreen user={user} />
  return <SignedIn key={user.uid} user={user} />
}

function SignedIn({ user }: { user: AuthUser }) {
  const repo = useRepository()
  const profile = useSubscription<UserProfile | null>((cb) => repo.users.subscribeProfile(user.uid, cb), [user.uid])

  const teams = useSubscription<Team[]>((cb) => repo.teams.subscribeMine(cb), [user.uid])
  const [adding, setAdding] = useState(false)
  // 表示中のタブ。チームを切り替えても、設定タブの「チームを追加」から戻っても、同じタブを開く（#59）
  const [tab, setTab] = useState<TabId>('schedule')
  const { run } = useFeedback()
  // チームの切り替えは画面上部のヘッダー、追加は設定タブから行う（#59）
  const navigation = useMemo<TeamNavigation | null>(
    () =>
      repo.supports?.multipleTeams && teams
        ? { teams, select: (teamId) => void run(() => repo.teams.select(teamId)), add: () => setAdding(true) }
        : null,
    [repo, teams, run],
  )
  if (profile === undefined || teams === undefined) return <Splash />
  if (profile === null) return <ConnectionIssue />
  // 2回目以降のログインでは teamId がわかるので、参加コードの入力は不要
  if (!profile.teamId || adding) return <TeamEntryScreen profile={profile} onDone={profile.teamId ? () => setAdding(false) : undefined} />
  return (
    <TeamNavigationContext.Provider value={navigation}>
      <TeamSession key={profile.teamId} user={user} profile={profile} teamId={profile.teamId} tab={tab} onTabChange={setTab} />
    </TeamNavigationContext.Provider>
  )
}

function TeamSession({
  user,
  profile,
  teamId,
  tab,
  onTabChange,
}: {
  user: AuthUser
  profile: UserProfile
  teamId: string
  tab: TabId
  onTabChange(tab: TabId): void
}) {
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
  // 削除中の画面は削除を始めた管理者だけに出す。ほかのメンバーは、削除が完了して所属が外れるまで通常どおり使える
  if (team?.deleting && team.deletionUid === user.uid) return <TeamDeletion teamId={teamId} />
  if (!session) return <ConnectionIssue teamId={teamId} />
  return (
    <SessionContext.Provider value={session}>
      <MainShell tab={tab} onTabChange={onTabChange} />
    </SessionContext.Provider>
  )
}

function ConnectionIssue({ teamId }: { teamId?: string }) {
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
      {teamId && <OtherTeams teamId={teamId} />}
    </main>
  )
}

function TeamDeletion({ teamId }: { teamId: string }) {
  const repo = useRepository()
  const { run } = useFeedback()
  const { refresh } = useRefresh()
  const [busy, setBusy] = useState(false)
  return (
    <main className="card" style={{ margin: 24, padding: 24 }}>
      <h1>チームを削除中です</h1>
      <p>削除の途中で止まっています。通信状態を確認して、削除を再開してください。完了するまで、ほかのメンバーはこのチームを通常どおり使えます。他のチームには影響しません。</p>
      <button className="btn btn-danger" disabled={busy} onClick={async () => {
        setBusy(true)
        // 削除後は購読を張り直す（削除前から開いていたプロフィールの購読が、所属の更新を受け取らないことがあるため）
        if (await run(() => repo.teams.remove(teamId), 'チームを削除しました')) refresh()
        setBusy(false)
      }}>削除を再開</button>
      <button className="btn btn-secondary" onClick={() => run(() => repo.auth.signOut())}>ログアウト</button>
      <OtherTeams teamId={teamId} />
    </main>
  )
}

/**
 * 読み込めない画面・削除中の画面からも、ほかのチームへ切り替え・追加できるようにする。
 * 通常の画面のヘッダーと設定タブはここでは表示されないため（#59）
 */
function OtherTeams({ teamId }: { teamId: string }) {
  const navigation = useTeamNavigation()
  if (!navigation) return null
  return (
    <div className={styles.teamRecovery}>
      {canSwitchTeam(navigation, teamId) && (
        <label className="field">
          <span className="label">ほかのチームを表示</span>
          <TeamSelect teamId={teamId} teamName="" variant="field" />
        </label>
      )}
      <button className="btn btn-secondary" onClick={navigation.add}>
        チームを追加
      </button>
    </div>
  )
}
