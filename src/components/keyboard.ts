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
 * The hidden field removes itself as soon as focus moves on, handing anything typed into it to the new field, or after
 * 5 s if nothing takes focus (a refused save).
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
  // Letters typed before the title takes focus land here: they go on to the title, as typing (Bumblebee 1dfbb133).
  const handOver = () => {
    const text = proxy.value
    remove()
    const target = document.activeElement as HTMLElement | null
    if (!text || !target || !(target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
    document.execCommand('insertText', false, text)
    // iOS settles its own caret after the focus change and put it back at the start (native run), so what he typed
    // next went before these letters. Put the caret after them again once that has settled.
    const toEnd = () => {
      if (document.activeElement !== target) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) { target.setSelectionRange(target.value.length, target.value.length); return }
      const range = document.createRange(); range.selectNodeContents(target); range.collapse(false)
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    }
    toEnd(); requestAnimationFrame(toEnd); setTimeout(toEnd, 150)
  }
  proxy.addEventListener('blur', () => setTimeout(handOver, 0), { once: true })
  proxy.focus({ preventScroll: true })
}
