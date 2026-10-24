import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshContext } from './contexts'

/** 再取得ボタンと画面復帰（visibilitychange）で、すべての購読を張り直す */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1)
    setRefreshing(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setRefreshing(false), 700)
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRefreshKey((key) => key + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const value = useMemo(() => ({ refreshKey, refreshing, refresh }), [refreshKey, refreshing, refresh])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}
