import { useEffect, useMemo, useState, type DependencyList } from 'react'
import type { Unsubscribe } from '../data/repository'
import { useRefresh } from './contexts'

/** 再取得は直前の値を保持し、別の購読先には古い値を持ち越さない。 */
export function useSubscription<T>(
  subscribe: ((cb: (value: T) => void) => Unsubscribe) | null,
  deps: DependencyList,
): T | undefined {
  const { refreshKey, suspended, beginSubscription } = useRefresh()
  // 呼び出し側の識別子（チームID・予定IDなど）が変わったときだけ別の購読として扱う。
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const scope = useMemo(() => Symbol(), deps)
  const [snapshot, setSnapshot] = useState<{ scope: symbol; value: T }>()

  useEffect(() => {
    if (!subscribe || suspended) return
    let active = true
    const finish = beginSubscription()
    const unsubscribe = subscribe((next) => {
      if (!active) return
      finish()
      setSnapshot({ scope, value: next })
    })
    return () => {
      active = false
      unsubscribe()
      finish()
    }
    // subscribe は毎回作られるので、購読先はscopeで判定する。
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, refreshKey, suspended, beginSubscription])
  return subscribe && snapshot?.scope === scope ? snapshot.value : undefined
}
