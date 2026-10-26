import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { deletionRun } from '../src/lib/deletion'
import { repositoryError } from '../src/data/firebase/errors'

describe('deletion stopping policy (#104)', () => {
  it('does not start another batch after a pause or after its operation budget', () => {
    const run = deletionRun(() => {}, 3)
    run.completed(2, 'メモ')
    expect(() => run.check(2)).toThrow('今回の削除上限')
    run.pause()
    expect(() => run.check()).toThrow('削除を停止')
  })
  it('distinguishes quota exhaustion from permissions and connectivity', () => {
    expect(repositoryError(new FirebaseError('resource-exhausted', 'quota')).message).toContain('自動では再試行しません')
    expect(repositoryError(new FirebaseError('unavailable', 'offline')).message).toContain('通信状態')
    expect(repositoryError(new FirebaseError('permission-denied', 'denied')).message).toContain('権限')
  })
})
