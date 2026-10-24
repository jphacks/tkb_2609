import type { EquipmentItem } from '../types'

const collator = new Intl.Collator('ja')

/** 誰も持っていない用具を上、持たれている用具を下に。各グループ内は50音順（よみがな優先） */
export function sortEquipment(items: EquipmentItem[]): EquipmentItem[] {
  const key = (item: EquipmentItem) => item.reading || item.name
  return [...items].sort((a, b) => {
    const heldA = a.holderUid !== null
    const heldB = b.holderUid !== null
    if (heldA !== heldB) return heldA ? 1 : -1
    return collator.compare(key(a), key(b))
  })
}
