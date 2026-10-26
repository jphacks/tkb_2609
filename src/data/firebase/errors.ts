import { FirebaseError } from 'firebase/app'
import { RepositoryError } from '../repository'
export function repositoryError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error
  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'permission-denied': 'この操作は許可されていません。権限とチームへの所属を確認してください。',
      'resource-exhausted': '利用上限に達したため停止しました。Firestoreの使用量を管理者が確認し、日次上限の場合は太平洋時間の午前0時ごろのリセット後に再開してください。自動では再試行しません。',
      unavailable: '接続できません。通信状態を確認して、もう一度お試しください。',
      'not-found': 'データが見つかりません。再取得してください。',
      'auth/requires-recent-login': '本人確認の有効期限が切れました。再認証して削除を再開してください。',
      'auth/user-mismatch': '登録したアカウントと異なります。同じアカウントで本人確認してください。',
      'auth/popup-closed-by-user': '本人確認が中止されました。',
      'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/invalid-email': 'メールアドレスを確認してください。',
      'auth/email-already-in-use':
        'このメールアドレスはすでに登録されています。Google で登録した場合は「Google でログイン」を使ってください。',
      'auth/weak-password': 'パスワードの強度が不足しています。',
      // パスワードポリシー（8文字以上・大文字・小文字・数字・記号）を満たさない。
      // ログイン時は「強制アップグレード」により、条件を満たす前の古いパスワードでも発生する
      'auth/password-does-not-meet-requirements':
        'パスワードが条件（8文字以上・大文字・小文字・数字・記号）を満たしていません。ログインできない場合は「パスワードを忘れた場合」から新しいパスワードを設定してください。',
      // Google ログイン（#31）
      'auth/popup-blocked': 'ログイン画面がブロックされました。ブラウザでポップアップを許可してから、もう一度お試しください。',
      'auth/account-exists-with-different-credential':
        'このメールアドレスは別の方法で登録されています。メールアドレスとパスワードでログインしてください。',
      'auth/operation-not-allowed': 'この方法でのログインは現在使えません。メールアドレスとパスワードでログインしてください。',
      'auth/unauthorized-domain': 'このアドレスからは Google でログインできません。公開中のアドレスから開いてください。',
      'auth/web-storage-unsupported': 'このブラウザでは Google でログインできません。Safari や Chrome で開いてください。',
      'auth/network-request-failed': '認証サーバーに接続できません。通信状態を確認してください。',
      'auth/too-many-requests': '操作が多すぎます。少し待ってからお試しください。',
    }
    return new RepositoryError(messages[error.code] || '処理に失敗しました。再取得してもう一度お試しください。')
  }
  return new RepositoryError('処理に失敗しました。もう一度お試しください。')
}
