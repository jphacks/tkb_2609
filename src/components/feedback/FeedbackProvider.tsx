import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRepository } from '../../app/contexts'
import { RepositoryError } from '../../data/repository'
import { FeedbackContext, type ConfirmOptions, type Feedback } from './context'
import styles from './feedback.module.css'

interface PendingConfirm extends ConfirmOptions {
  resolve(ok: boolean): void
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const repository = useRepository()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const toast = useCallback((message: string) => {
    setToastMessage(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastMessage(null), 2600)
  }, [])

  useEffect(() => repository.onError?.((error) => toast(error.message)), [repository, toast])

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const run = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string) => {
      try {
        await action()
        if (successMessage) toast(successMessage)
        return true
      } catch (error) {
        toast(error instanceof RepositoryError ? error.message : '通信に失敗しました。もう一度お試しください')
        return false
      }
    },
    [toast],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const value = useMemo<Feedback>(() => ({ toast, confirm, run }), [toast, confirm, run])

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {toastMessage && (
        <div className={styles.toast} role="status">
          {toastMessage}
        </div>
      )}

      {pending && (
        <div className={styles.backdrop} onClick={() => close(false)}>
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title" className={styles.title}>
              {pending.title}
            </h2>
            {pending.message && <p className={styles.message}>{pending.message}</p>}
            <div className={styles.actions}>
              <button className="btn btn-secondary" onClick={() => close(false)}>
                キャンセル
              </button>
              <button className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
                {pending.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}
