import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

export interface Feedback {
  toast(message: string): void
  /** OK なら true */
  confirm(options: ConfirmOptions): Promise<boolean>
  /** 失敗時にトーストを出しつつ実行する。成功したら true */
  run(action: () => Promise<unknown>, successMessage?: string): Promise<boolean>
}

export const FeedbackContext = createContext<Feedback | null>(null)

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext)
  if (!feedback) throw new Error('FeedbackContext がありません')
  return feedback
}
