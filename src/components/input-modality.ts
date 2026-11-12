import { useEffect } from 'react'

/**
 * Marks the page with what was used last, a pointer or the keyboard, so a menu opened by a click or tap can move
 * focus to its first item for the keyboard's sake without drawing the ring there. WebKit shows `:focus-visible`
 * after a click once script moves focus, so the browser's own heuristic isn't enough.
 */
export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement
    const pointer = () => { root.dataset.input = 'pointer' }
    const keyboard = (e: KeyboardEvent) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) root.dataset.input = 'keyboard' }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', keyboard, true)
      delete root.dataset.input
    }
  }, [])
}
