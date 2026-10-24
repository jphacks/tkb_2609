import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * 並び順が変わったとき、各行を元の位置から新しい位置へ滑らかに動かす（FLIP）。
 * 複数列のときは横にも動く。行には data-flip-id を付ける。order は並び順を表す文字列。
 */
export function useFlipAnimation(container: RefObject<HTMLElement | null>, order: string) {
  const positions = useRef(new Map<string, { x: number; y: number }>())

  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    const next = new Map<string, { x: number; y: number }>()
    root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((node) => {
      const id = node.dataset.flipId!
      const rect = node.getBoundingClientRect()
      const pos = { x: rect.left - origin.left, y: rect.top - origin.top }
      next.set(id, pos)
      const previous = positions.current.get(id)
      if (previous && (previous.x !== pos.x || previous.y !== pos.y)) {
        node.animate(
          [{ transform: `translate(${previous.x - pos.x}px, ${previous.y - pos.y}px)` }, { transform: 'none' }],
          { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
      }
    })
    positions.current = next
  }, [container, order])
}
