// Firebase Authentication のパスワードポリシー（本番で「必須」に設定済み）と同じ条件にそろえる。
// 記号は Firebase が認める30文字だけを数える（全角文字・空白・+ = などは記号に含まれない）
export const PASSWORD_SYMBOLS = '^$*.[]{}()?"!@#%&/\\,><\':;|_~`-'

export const PASSWORD_RULES: { label: string; test: (password: string) => boolean }[] = [
  { label: '8文字以上', test: (p) => p.length >= 8 },
  { label: '大文字を含む', test: (p) => /[A-Z]/.test(p) },
  { label: '小文字を含む', test: (p) => /[a-z]/.test(p) },
  { label: '数字を含む', test: (p) => /[0-9]/.test(p) },
  { label: '記号（!@#% など）を含む', test: (p) => [...p].some((c) => PASSWORD_SYMBOLS.includes(c)) },
]

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}
