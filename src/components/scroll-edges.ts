import { useCallback, useEffect, useRef } from 'react'

/** Marks a sideways scroller with where it has got to: `has-more-right` while columns are clipped on the right, `is-scrolled` once it has moved off its start. */
export function markEdges(el: HTMLElement) {
  el.classList.toggle('has-more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  el.classList.toggle('is-scrolled', el.scrollLeft > 0)
}

/**
 * Keeps a scroller's edge classes current on scroll and whenever it or its content changes size. Classes rather than a
 * CSS scroll timeline: WebKit crashes in `ScrollTimeline` when a scroller with one is resized (Lead b43f8f97).
 */
export function watchEdges(el: HTMLElement): () => void {
  const mark = () => markEdges(el)
  el.addEventListener('scroll', mark, { passive: true })
  // The scroller's own box covers a narrower block; its child covers a column added, removed or resized.
  const sizes = new ResizeObserver(mark)
  sizes.observe(el)
  if (el.firstElementChild) sizes.observe(el.firstElementChild)
  mark()
  return () => {
    el.removeEventListener('scroll', mark)
    sizes.disconnect()
  }
}

/**
 * A ref callback that watches whichever element it's given. Safe to call from an inline ref that React calls again on
 * every commit: it only starts over when the element itself changes, and stops on unmount.
 */
export function useScrollEdges(): (el: HTMLElement | null) => void {
  const watched = useRef<{ el: HTMLElement; stop: () => void } | null>(null)
  useEffect(() => () => {
    watched.current?.stop()
    watched.current = null
  }, [])
  return useCallback((el: HTMLElement | null) => {
    if (!el || watched.current?.el === el) return
    watched.current?.stop()
    watched.current = { el, stop: watchEdges(el) }
  }, [])
}
