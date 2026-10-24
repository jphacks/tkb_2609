import { FirebaseError } from 'firebase/app'
import { RepositoryError } from '../repository'
export function repositoryError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error
  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'permission-denied': 'この操作は許可されていません。権限とチームへの所属を確認してください。',
      unavailable: '接続できません。通信状態を確認して、もう一度お試しください。',
      'not-found': 'データが見つかりません。再取得してください。',
      'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/invalid-email': 'メールアドレスを確認してください。',
      'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。',
      'auth/weak-password': 'パスワードの強度が不足しています。',
      // パスワードポリシー（8文字以上・大文字・小文字・数字・記号）を満たさない。
      // ログイン時は「強制アップグレード」により、条件を満たす前の古いパスワードでも発生する
      'auth/password-does-not-meet-requirements':
        'パスワードが条件（8文字以上・大文字・小文字・数字・記号）を満たしていません。ログインできない場合は「パスワードを忘れた場合」から新しいパスワードを設定してください。',
      'auth/network-request-failed': '認証サーバーに接続できません。通信状態を確認してください。',
      'auth/too-many-requests': '操作が多すぎます。少し待ってからお試しください。',
    }
    return new RepositoryError(messages[error.code] || '処理に失敗しました。再取得してもう一度お試しください。')
  }
  return new RepositoryError('処理に失敗しました。もう一度お試しください。')
}
