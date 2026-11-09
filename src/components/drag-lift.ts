import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fixedOffset } from './fixed-coords'

// One feel wherever something is dragged (Brian, Nov 8): the thing itself lifts under the pointer, a copy that keeps the
// grab point under it, tilts a little and takes the floating shadow. A hatched slot of its size waits where it would
// land, and its neighbours slide to make room: their places are measured before the redraw and they're moved after it
// (FLIP). On release the copy glides into the slot and flattens, and the real thing shows as it lands. Under reduced
// motion it still lifts and the slot still shows; nothing tilts, slides or glides.

const SETTLE_MS = 220, GONE_MS = 150, SHIFT_MS = 180

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export interface Lift {
  /** Where the thing was when it lifted. */
  readonly origin: DOMRect
  move(x: number, y: number): void
  /** Glides to `home` (where the thing is now) or fades where it is when there's nowhere to go; resolves when done. */
  settle(home: DOMRect | null): Promise<void>
  remove(): void
}

/**
 * Lifts a copy of `source` with the pointer at (x, y). A table row is cloned with its table, so its cells keep their
 * widths. `raise` keeps the copy that far above a finger, which would otherwise cover it; `badge` is a count on it.
 */
export function lift(source: HTMLElement, x: number, y: number, options: { tilt?: number; raise?: number; badge?: string } = {}): Lift {
  const origin = source.getBoundingClientRect()
  const clone = source.cloneNode(true) as HTMLElement
  // Nothing finds the copy where it looks for the real thing.
  for (const name of ['id', 'data-card', 'data-row', 'data-page', 'data-dragging']) clone.removeAttribute(name)
  clone.classList.remove('is-lifted', 'is-landing', 'is-dragging')
  let body: HTMLElement = clone
  if (source instanceof HTMLTableRowElement) {
    const widths = [...source.children].map(cell => cell.getBoundingClientRect().width)
    ;[...clone.children].forEach((cell, i) => { (cell as HTMLElement).style.width = `${widths[i]}px` })
    const table = document.createElement('table')
    table.className = source.closest('table')?.className ?? ''
    table.style.width = `${origin.width}px`
    const tbody = document.createElement('tbody')
    tbody.append(clone); table.append(tbody)
    body = table
  }
  const wrap = document.createElement('div')
  wrap.className = 'drag-lift'
  wrap.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('div')
  inner.className = 'drag-lift-body'
  inner.style.width = `${origin.width}px`
  inner.style.height = `${origin.height}px`
  inner.style.setProperty('--lift-tilt', `${options.tilt ?? 3}deg`)
  inner.append(body)
  if (options.badge) {
    const badge = document.createElement('span')
    badge.className = 'drag-lift-badge'
    badge.textContent = options.badge
    inner.append(badge)
  }
  wrap.append(inner)
  document.body.append(wrap)
  const grab = { x: x - origin.left, y: y - origin.top + (options.raise ?? 0) }
  // It turns about the grab point, so it stays under the pointer as it tilts.
  inner.style.transformOrigin = `${grab.x}px ${grab.y}px`
  // Placed from the layout viewport, as the pointer is measured from the visible part (fixed-coords.ts).
  const at = (left: number, top: number) => { wrap.style.transform = `translate(${left}px, ${top + fixedOffset()}px)` }
  const move = (px: number, py: number) => at(px - grab.x, py - grab.y)
  move(x, y)
  // Flat where it was for a frame, then up: the lift itself is seen.
  requestAnimationFrame(() => inner.classList.add('is-up'))
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms))
  return {
    origin,
    move,
    settle(home) {
      inner.classList.remove('is-up')
      if (!home) { wrap.classList.add('is-gone'); return wait(GONE_MS) }
      wrap.classList.add('is-settling')
      at(home.left, home.top)
      return wait(SETTLE_MS)
    },
    remove() { wrap.remove() },
  }
}

export type Rects = Map<Element, DOMRect>

/** Where each element is now, to the eye: a slide still under way counts. */
export const measure = (els: Iterable<Element>): Rects => new Map([...els].map(el => [el, el.getBoundingClientRect()]))

/** After a redraw, each element slides from where it was (`before`, measured first) to where it is now. */
export function flip(before: Rects, els: Iterable<Element>) {
  if (reducedMotion()) return
  for (const el of els) {
    const was = before.get(el)
    // Not drawn before (the lifted card), so it has nowhere to come from.
    if (!was || (!was.width && !was.height)) continue
    // A slide still under way goes before measuring, so the new one starts from where the eye had it.
    for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel()
    const now = el.getBoundingClientRect()
    const dx = was.left - now.left, dy = was.top - now.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { id: 'flip', duration: SHIFT_MS, easing: 'cubic-bezier(.2, 0, 0, 1)' })
  }
}

/** The box the layout gives an element, without a slide under way: the pointer is read against places, not motion. */
export function layoutRect(el: Element): DOMRect {
  const rect = el.getBoundingClientRect()
  const transform = getComputedStyle(el).transform
  if (!transform || transform === 'none') return rect
  const m = new DOMMatrixReadOnly(transform)
  return new DOMRect(rect.left - m.e, rect.top - m.f, rect.width, rect.height)
}

/**
 * A view's side of the feel: `pickUp` lifts the thing and measures the room; `willRedraw` is called before each redraw
 * that moves the slot, so `scope`'s elements slide after it; `land` sends the copy gliding to where `homeOf` finds the
 * row drawn now (its new place, or its old one after a cancel), and `landing` names that row while it's hidden under it.
 */
export function useRoom(scope: () => Element[], homeOf: (rowId: string) => HTMLElement | null) {
  const copy = useRef<Lift | null>(null)
  const [landing, setLanding] = useState<{ rowId: string; copy: Lift } | null>(null)
  const before = useRef<Rects | null>(null)
  const willRedraw = () => { before.current = measure(scope()) }
  useLayoutEffect(() => { if (before.current) { flip(before.current, scope()); before.current = null } })
  useLayoutEffect(() => {
    if (!landing) return
    const home = homeOf(landing.rowId)
    void landing.copy.settle(home ? home.getBoundingClientRect() : null).then(() => setLanding(now => (now === landing ? null : now)))
    // The copy goes in the same paint as the row shows.
    return () => landing.copy.remove()
  }, [landing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => copy.current?.remove(), [])
  const pickUp = (el: HTMLElement, x: number, y: number, options?: Parameters<typeof lift>[3]) => {
    copy.current?.remove()
    copy.current = lift(el, x, y, options)
    willRedraw()
    return copy.current
  }
  const land = (rowId: string | null) => {
    const lifted = copy.current
    copy.current = null
    willRedraw()
    if (rowId && lifted) setLanding({ rowId, copy: lifted })
    else lifted?.remove()
  }
  return { copy, landing: landing?.rowId ?? null, willRedraw, pickUp, land }
}

/** The rows drawn with the slot among them: before the row `before` names, at the end when it's null, nowhere when undefined. */
export function withSlot<T>(rows: readonly T[], idOf: (row: T) => string, before: string | null | undefined, draw: (row: T, index: number) => ReactNode, slot: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  rows.forEach((row, index) => {
    if (before === idOf(row)) out.push(slot)
    out.push(draw(row, index))
  })
  if (before === null) out.push(slot)
  return out
}
