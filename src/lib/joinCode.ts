// 読み間違えやすい 0/O、1/I/L は使わない
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const JOIN_CODE_LENGTH = 8

export function generateJoinCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(JOIN_CODE_LENGTH))
  return Array.from(values, (v) => ALPHABET[v % ALPHABET.length]).join('')
}

/** 入力ゆれを吸収する（小文字・空白・ハイフン） */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}
