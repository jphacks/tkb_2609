import { RepositoryError } from '../data/repository'

export const DELETION_RUN_LIMIT = 1000
export interface DeletionProgress { deleted: number; phase: string; running: boolean; message?: string }
export interface DeletionEstimate { events: number; equipment: number; members: number; minimumDocuments: number }
/** 件数は今回の成功確認分だけ。プロジェクト全体の日次使用量ではない。 */
export function deletionRun(notify: (value: DeletionProgress) => void, limit = DELETION_RUN_LIMIT) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 200000) throw new RepositoryError('削除操作の上限が不正です。')
  let paused = false
  const state: DeletionProgress = { deleted: 0, phase: '準備', running: true }
  notify({ ...state })
  return {
    pause() { paused = true },
    remaining() { return Math.max(0, limit - state.deleted) },
    check(needed = 1) {
      if (paused) throw new RepositoryError('削除を停止しました。処理済みのデータは戻りません。後から再開できます。')
      if (state.deleted + needed > limit) throw new RepositoryError(`今回の削除上限（${limit}件）で停止しました。利用状況を確認し、必要なら翌日以降に再開してください。`)
    },
    completed(count: number, phase: string) { state.deleted += count; state.phase = phase; notify({ ...state }) },
    finish(message?: string) { state.running = false; state.message = message; notify({ ...state }) },
  }
}
