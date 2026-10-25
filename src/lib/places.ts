export const MAX_PLACES = 20
export const MAX_PLACE_LENGTH = 100
export function placesError(places: string[]): string | null {
  if (places.length > MAX_PLACES) return `場所は${MAX_PLACES}件まで登録できます。`
  if (places.some((p) => !p.trim() || p.trim().length > MAX_PLACE_LENGTH)) return `場所は1〜${MAX_PLACE_LENGTH}文字で入力してください。`
  if (new Set(places.map((p) => p.trim())).size !== places.length) return '同じ場所が重複しています。'
  return null
}
