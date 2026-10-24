import { createContext, useContext } from 'react'
import type { Repository } from '../data/repository'
import type { AuthUser, Member, Team, UserProfile } from '../types'

export const RepositoryContext = createContext<Repository | null>(null)

export function useRepository(): Repository {
  const repo = useContext(RepositoryContext)
  if (!repo) throw new Error('RepositoryContext がありません')
  return repo
}

export interface RefreshState {
  /** 変わるたびに購読を張り直す */
  refreshKey: number
  refreshing: boolean
  suspended: boolean
  beginSubscription(): () => void
  refresh(): void
}

export const RefreshContext = createContext<RefreshState>({
  refreshKey: 0,
  refreshing: false,
  suspended: false,
  beginSubscription: () => () => {},
  refresh: () => {},
})

export const useRefresh = () => useContext(RefreshContext)

export interface Session {
  user: AuthUser
  profile: UserProfile
  team: Team
  members: Member[]
  me: Member
  isAdmin: boolean
  canEditEvents: boolean
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionContext がありません')
  return session
}
