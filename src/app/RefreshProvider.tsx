import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshContext } from './contexts'

/** 画面復帰・再取得で購読を張り直し、初回通知まで更新中として扱う。 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const visible = useRef(document.visibilityState !== 'hidden')
  const [suspended, setSuspended] = useState(() => document.visibilityState === 'hidden')
  const pending = useRef(new Set<symbol>())
  const [pendingCount, setPendingCount] = useState(0)
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])
  const beginSubscription = useCallback(() => {
    const token = Symbol()
    pending.current.add(token)
    setPendingCount(pending.current.size)
    return () => {
      if (pending.current.delete(token)) setPendingCount(pending.current.size)
    }
  }, [])

  useEffect(() => {
    const onVisible = () => {
      const next = document.visibilityState !== 'hidden'
      if (next === visible.current) return
      visible.current = next
      setSuspended(!next)
      if (next) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const value = useMemo(
    () => ({ refreshKey, refreshing: pendingCount > 0, refresh, suspended, beginSubscription }),
    [refreshKey, pendingCount, refresh, suspended, beginSubscription],
  )
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}
