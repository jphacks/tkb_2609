// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefreshProvider } from '../src/app/RefreshProvider'
import { useRefresh } from '../src/app/contexts'
import { useSubscription } from '../src/app/useSubscription'

const wrapper = ({ children }: { children: ReactNode }) => <RefreshProvider>{children}</RefreshProvider>
function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}
beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(cleanup)
describe('realtime subscription lifecycle', () => {
  it('tracks actual first notifications, keeps data on refresh and ignores callbacks from the old listener', () => {
    const callbacks: ((value: string) => void)[] = [],
      stops: ReturnType<typeof vi.fn>[] = []
    const subscribe = vi.fn((cb: (value: string) => void) => {
      callbacks.push(cb)
      const stop = vi.fn()
      stops.push(stop)
      return stop
    })
    const { result, unmount } = renderHook(() => ({ value: useSubscription(subscribe, ['team']), ...useRefresh() }), {
      wrapper,
    })
    expect(result.current.refreshing).toBe(true)
    act(() => callbacks[0]('first'))
    expect(result.current.value).toBe('first')
    expect(result.current.refreshing).toBe(false)
    act(() => result.current.refresh())
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(result.current.value).toBe('first')
    expect(result.current.refreshing).toBe(true)
    act(() => callbacks[0]('late old data'))
    expect(result.current.value).toBe('first')
    expect(result.current.refreshing).toBe(true)
    act(() => callbacks[1]('fresh'))
    expect(result.current.value).toBe('fresh')
    expect(result.current.refreshing).toBe(false)
    unmount()
    expect(stops[1]).toHaveBeenCalledTimes(1)
  })
  it('stops listeners in the background and reconnects once per foreground transition', () => {
    const stop = vi.fn(),
      subscribe = vi.fn((cb: (value: number) => void) => {
        cb(1)
        return stop
      })
    const { result } = renderHook(() => ({ value: useSubscription(subscribe, ['team']), ...useRefresh() }), { wrapper })
    act(() => visibility('hidden'))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(result.current.suspended).toBe(true)
    act(() => result.current.refresh())
    expect(subscribe).toHaveBeenCalledTimes(1)
    act(() => visibility('visible'))
    expect(subscribe).toHaveBeenCalledTimes(2)
    act(() => visibility('visible'))
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(result.current.value).toBe(1)
  })
  it('does not show data from a previous team/record while a new subscription is loading', () => {
    const callbacks: ((v: string) => void)[] = []
    const subscribe = (cb: (v: string) => void) => {
      callbacks.push(cb)
      return () => {}
    }
    const { result, rerender } = renderHook(({ id }) => useSubscription(subscribe, [id]), {
      wrapper,
      initialProps: { id: 'old' },
    })
    act(() => callbacks[0]('old team data'))
    expect(result.current).toBe('old team data')
    rerender({ id: 'new' })
    expect(result.current).toBeUndefined()
    act(() => callbacks[0]('late old team data'))
    expect(result.current).toBeUndefined()
    act(() => callbacks[1]('new team data'))
    expect(result.current).toBe('new team data')
  })
  it('waits for all mounted subscriptions, including an empty/error fallback emission', () => {
    let a: ((v: number[]) => void) | undefined, b: ((v: number[]) => void) | undefined
    const { result } = renderHook(
      () => {
        useSubscription<number[]>(
          (cb) => {
            a = cb
            return () => {}
          },
          ['a'],
        )
        useSubscription<number[]>(
          (cb) => {
            b = cb
            return () => {}
          },
          ['b'],
        )
        return useRefresh()
      },
      { wrapper },
    )
    act(() => a!([1]))
    expect(result.current.refreshing).toBe(true)
    act(() => b!([]))
    expect(result.current.refreshing).toBe(false)
  })
})
