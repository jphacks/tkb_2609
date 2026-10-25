import { describe, expect, it, vi } from 'vitest'
import type { Auth } from 'firebase/auth'
import { recoveringSubscription } from '../src/data/firebase/recoveringSubscription'

const denied = { code: 'permission-denied' }
function setup(token: Promise<string> = Promise.resolve('test-token')) {
  const user = { getIdToken: vi.fn(() => token) }
  const auth = { currentUser: user } as unknown as Auth
  const listeners: { next: (value: string) => void; error: (error: unknown) => void; stop: ReturnType<typeof vi.fn> }[] = []
  const subscribe = vi.fn((next: (value: string) => void, error: (error: unknown) => void) => {
    const stop = vi.fn()
    listeners.push({ next, error, stop })
    return stop
  })
  const next = vi.fn(), error = vi.fn()
  const stop = recoveringSubscription(auth, subscribe, next, error)
  return { auth, user, listeners, subscribe, next, error, stop }
}
describe('subscription authentication recovery (#94)', () => {
  it('keeps cached data and recovers a rejected listener once with a fresh token', async () => {
    const s = setup()
    s.listeners[0].next('cache')
    s.listeners[0].error(denied)
    await Promise.resolve()
    expect(s.next).toHaveBeenCalledWith('cache')
    expect(s.user.getIdToken).toHaveBeenCalledWith(true)
    expect(s.listeners[0].stop).toHaveBeenCalledOnce()
    expect(s.subscribe).toHaveBeenCalledTimes(2)
    s.listeners[0].next('obsolete')
    s.listeners[0].error(denied)
    expect(s.next).toHaveBeenCalledTimes(1)
    s.listeners[1].next('server')
    expect(s.next).toHaveBeenLastCalledWith('server')
    expect(s.error).not.toHaveBeenCalled()
    s.stop()
    expect(s.listeners[1].stop).toHaveBeenCalledOnce()
  })
  it('reports actual permission denial even if cache or server data was received', async () => {
    const s = setup()
    s.listeners[0].next('cache')
    s.listeners[0].error(denied)
    await Promise.resolve()
    s.listeners[1].next('cache')
    s.listeners[1].error(denied)
    expect(s.error).toHaveBeenCalledExactlyOnceWith(denied)
    expect(s.subscribe).toHaveBeenCalledTimes(2)
  })
  it('does not restart or report after cancellation during token refresh', async () => {
    const s = setup()
    s.listeners[0].error(denied)
    s.stop()
    await Promise.resolve()
    s.listeners[0].error(denied)
    expect(s.subscribe).toHaveBeenCalledOnce()
    expect(s.error).not.toHaveBeenCalled()
  })
  it('does not restart for a different authenticated user', async () => {
    const s = setup()
    s.listeners[0].error(denied)
    Object.defineProperty(s.auth, 'currentUser', { value: null })
    await Promise.resolve()
    expect(s.subscribe).toHaveBeenCalledOnce()
    expect(s.error).not.toHaveBeenCalled()
  })
  it('reports token refresh failure', async () => {
    const failure = { code: 'auth/network-request-failed' }
    const s = setup(Promise.reject(failure))
    s.listeners[0].error(denied)
    await Promise.resolve()
    expect(s.error).toHaveBeenCalledExactlyOnceWith(failure)
  })
  it('reports other errors immediately without refreshing the token', () => {
    const s = setup(), failure = { code: 'unavailable' }
    s.listeners[0].error(failure)
    expect(s.error).toHaveBeenCalledExactlyOnceWith(failure)
    expect(s.user.getIdToken).not.toHaveBeenCalled()
  })
})
