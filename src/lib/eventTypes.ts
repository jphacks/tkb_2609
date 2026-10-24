import type { EventType } from '../types'

export function eventTypesError(types: EventType[]): string | null {
  if (types.length < 1 || types.length > 10) return '予定の種類は1〜10件にしてください'
  if (new Set(types.map((t) => t.id)).size !== types.length) return '予定の種類のIDが重複しています'
  if (
    types.some(
      (t) =>
        !t.id || t.id.length > 100 || !t.label.trim() || t.label.trim().length > 40 || !/^#[0-9a-f]{6}$/i.test(t.color),
    )
  )
    return '種類名は1〜40文字、色は有効なカラーコードを設定してください'
  return null
}
