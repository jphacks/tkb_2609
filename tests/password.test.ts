import { FirebaseError } from 'firebase/app'
import { describe, expect, it } from 'vitest'
import { repositoryError } from '../src/data/firebase/errors'
import { PASSWORD_SYMBOLS, isStrongPassword } from '../src/lib/password'

// 本番の Firebase パスワードポリシー（Issue #5）と同じ判定になっていること
describe('password policy (client side mirrors Firebase)', () => {
  it('accepts every symbol that Firebase allows', () => {
    expect([...PASSWORD_SYMBOLS]).toHaveLength(30)
    for (const symbol of PASSWORD_SYMBOLS) expect(isStrongPassword(`Abcdefg1${symbol}`)).toBe(true)
  })

  it.each([
    ['Abcdefg1+', '+ は Firebase の記号に含まれない'],
    ['Abcdefg1=', '= は Firebase の記号に含まれない'],
    ['Abcdefg1 ', '空白は記号に含まれない'],
    ['Abcdefg1あ', '日本語は記号に含まれない'],
    ['Abcdefg1！', '全角の記号は含まれない'],
    ['Abc1!', '8文字未満'],
    ['abcdefg1!', '大文字なし'],
    ['ABCDEFG1!', '小文字なし'],
    ['Abcdefgh!', '数字なし'],
  ])('rejects %s (%s)', (password) => {
    expect(isStrongPassword(password)).toBe(false)
  })

  it('accepts the mock and test passwords used in the project', () => {
    expect(isStrongPassword('Bukatsu#2026')).toBe(true)
    expect(isStrongPassword('Example123!')).toBe(true)
  })
})

describe('Firebase error messages', () => {
  it('guides users to reset the password when it no longer meets the policy', () => {
    const message = repositoryError(new FirebaseError('auth/password-does-not-meet-requirements', 'x')).message
    expect(message).toContain('条件')
    expect(message).toContain('パスワードを忘れた場合')
  })
})
