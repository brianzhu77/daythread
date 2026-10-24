import { useEffect, useState } from 'react'

/**
 * B48: where the phone toolbar sits with the keyboard up. iOS doesn't shrink the layout viewport for the keyboard, so a
 * fixed bottom stays behind it; the visual viewport is what he can see. Returns the visible bottom edge in layout
 * coordinates while a keyboard covers part of the screen, else null (the toolbar keeps its place above the tab bar).
 */
export function useKeyboardTop(): number | null {
  const [top, setTop] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // The keyboard's height doesn't depend on how far iOS has scrolled the visible part (offsetTop can reach it).
        // Under ~100 px is Safari's bars moving, not a keyboard.
        setTop(window.innerHeight - vv.height > 100 ? Math.round(vv.offsetTop + vv.height) : null)
      })
    }
    measure()
    vv.addEventListener('resize', measure); vv.addEventListener('scroll', measure)
    document.addEventListener('focusin', measure); document.addEventListener('focusout', measure)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', measure); vv.removeEventListener('scroll', measure)
      document.removeEventListener('focusin', measure); document.removeEventListener('focusout', measure)
    }
  }, [])
  return top
}
