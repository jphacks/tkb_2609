import { useEffect, useState, type DependencyList } from 'react'
import type { Unsubscribe } from '../data/repository'
import { useRefresh } from './contexts'

/**
 * subscribe 系のメソッドを購読し、最新の値を返す。読み込み中は undefined。
 * 再取得ボタンや画面復帰で refreshKey が変わると張り直す（直前の値は表示したまま）。
 */
export function useSubscription<T>(
  subscribe: ((cb: (value: T) => void) => Unsubscribe) | null,
  deps: DependencyList,
): T | undefined {
  const { refreshKey } = useRefresh()
  const [value, setValue] = useState<T>()

  useEffect(() => {
    if (!subscribe) return
    return subscribe((next) => setValue(() => next))
    // subscribe は毎回作り直される関数なので、依存は呼び出し側の deps で管理する
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey])

  return value
}
