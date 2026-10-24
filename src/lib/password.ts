export const PASSWORD_RULES: { label: string; test: (password: string) => boolean }[] = [
  { label: '8文字以上', test: (p) => p.length >= 8 },
  { label: '大文字を含む', test: (p) => /[A-Z]/.test(p) },
  { label: '小文字を含む', test: (p) => /[a-z]/.test(p) },
  { label: '数字を含む', test: (p) => /[0-9]/.test(p) },
  { label: '記号を含む', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}
