import { useEffect, type RefObject } from 'react'

/** Call `handler` when a pointer/key event occurs outside `ref`. */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return
    function onPointer(e: MouseEvent | TouchEvent) {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) handler()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handler()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, handler, active])
}
