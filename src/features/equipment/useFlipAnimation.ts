import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * 並び順が変わったとき、各行を元の位置から新しい位置へ滑らかに動かす（FLIP）。
 * 行には data-flip-id を付ける。order は並び順を表す文字列。
 */
export function useFlipAnimation(container: RefObject<HTMLElement | null>, order: string) {
  const positions = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const rootTop = root.getBoundingClientRect().top
    const next = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((node) => {
      const id = node.dataset.flipId!
      const top = node.getBoundingClientRect().top - rootTop
      next.set(id, top)
      const previous = positions.current.get(id)
      if (previous !== undefined && previous !== top) {
        node.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'none' }], {
          duration: 320,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        })
      }
    })
    positions.current = next
  }, [container, order])
}
