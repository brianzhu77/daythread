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

/**
 * iOS raises the keyboard only for a focus made inside the tap itself. A flow that saves, opens a page and only then
 * focuses a field there (a new page's or row's title) calls this inside the tap: a hidden field takes focus now, so
 * the keyboard comes up, and the title that takes focus later keeps it (Jazz's native run on 6b3f416a; Lead b50a8ee7).
 * The hidden field removes itself as soon as focus moves on, or after 5 s if nothing takes it (a refused save).
 * Touch screens only: with a mouse there's no keyboard to raise.
 */
export function holdKeyboard(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return
  const proxy = document.createElement('input')
  proxy.setAttribute('aria-hidden', 'true')
  proxy.tabIndex = -1
  // 16 px, or iOS zooms the page to the field.
  Object.assign(proxy.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', padding: '0', border: '0', opacity: '0', fontSize: '16px' })
  document.body.append(proxy)
  const remove = () => { clearTimeout(timer); proxy.remove() }
  const timer = setTimeout(() => { if (document.activeElement === proxy) proxy.blur(); remove() }, 5000)
  proxy.addEventListener('blur', remove, { once: true })
  proxy.focus({ preventScroll: true })
}
