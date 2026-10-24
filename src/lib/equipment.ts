import type { EquipmentItem } from '../types'

const collator = new Intl.Collator('ja')

/** 誰も持っていない用具を上、持たれている用具を下に。各グループ内は名前順 */
export function sortEquipment(items: EquipmentItem[]): EquipmentItem[] {
  return [...items].sort((a, b) => {
    const heldA = a.holderUid !== null
    const heldB = b.holderUid !== null
    if (heldA !== heldB) return heldA ? 1 : -1
    return collator.compare(a.name, b.name)
  })
}

/** 重複判定用のキー。全角・半角、大文字・小文字、空白の違いは同じ名前とみなす */
export function equipmentNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/** 同じ名前の用具がすでにあるか（編集中の用具自身は除く） */
export function isDuplicateEquipmentName(items: EquipmentItem[], name: string, exceptId?: string): boolean {
  const key = equipmentNameKey(name)
  return items.some((item) => item.id !== exceptId && equipmentNameKey(item.name) === key)
}

/** UIとFirestore実装で同じ入力制約を使う。 */
export function equipmentNameError(input: string): string | null {
  const name = input.normalize('NFKC').trim(),
    key = equipmentNameKey(name)
  if (!key) return '用具名を入力してください'
  if (name.length > 100) return '用具名は100文字以内で入力してください'
  if (key.includes('/') || key === '.' || key === '..' || key.startsWith('__')) return '用具名にこの文字は使えません'
  return null
}
