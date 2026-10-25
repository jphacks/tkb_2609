import type { Auth } from 'firebase/auth'
import type { Unsubscribe } from '../repository'

/** 終了した購読を新しい認証トークンで一度だけ再開する。権限拒否を無限に隠さない。 */
export function recoveringSubscription<T>(
  auth: Auth,
  subscribe: (next: (value: T) => void, error: (error: unknown) => void) => Unsubscribe,
  next: (value: T) => void,
  error: (error: unknown) => void,
): Unsubscribe {
  let active = true
  let retried = false
  let generation = 0
  let off: Unsubscribe = () => {}
  const user = auth.currentUser
  const current = () => active && auth.currentUser === user
  const start = () => {
    const revision = ++generation
    const live = () => current() && revision === generation
    off = subscribe(
      (value) => { if (live()) next(value) },
      (cause) => {
        if (!live()) return
        if ((cause as { code?: string })?.code !== 'permission-denied' || retried || !user) {
          error(cause)
          return
        }
        retried = true
        ++generation
        off()
        void user.getIdToken(true).then(
          () => { if (current()) start() },
          (cause: unknown) => { if (current()) error(cause) },
        )
      },
    )
  }
  start()
  return () => { active = false; off() }
}
