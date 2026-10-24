/**
 * Finding 11 (iPhone sweep): a `position: fixed` element is placed in layout-viewport coordinates, but iOS Safari
 * measures `getBoundingClientRect` from the visible part of the page, which it scrolls by `visualViewport.offsetTop`
 * while the keyboard is up (Ratchet's trace: the toolbar measured top 318 = 376 - 50 - 8 with offsetTop 60). A popover
 * placed straight from a measured rect then sits offsetTop too high. The difference is read from a fixed probe at
 * top 0, so an engine that measures from the layout viewport gets 0 and nothing changes there.
 */
let probe: HTMLElement | null = null

/** Add this to a measured y to get the `top` of a fixed element at that spot. */
export function fixedOffset(): number {
  if (typeof document === 'undefined') return 0
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none'
    document.body.append(probe)
  }
  return -probe.getBoundingClientRect().top
}

/** What he can see, in measured (getBoundingClientRect) coordinates. */
export function seenArea(): { top: number; bottom: number } {
  const vv = window.visualViewport
  if (!vv) return { top: 0, bottom: window.innerHeight }
  const top = vv.offsetTop - fixedOffset()
  return { top, bottom: top + vv.height }
}
