import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, type AnimationOptions } from 'motion'
import { fixedOffset } from './fixed-coords'

// One feel wherever something is dragged (Brian, Nov 8): the thing itself lifts under the pointer, a copy that keeps the
// grab point under it, tilts a little and takes the floating shadow. A hatched slot of its size waits where it would
// land, and its neighbours slide to make room: their places are measured before the redraw and they're moved after it
// (FLIP). On release the copy glides into the slot and flattens, and the real thing shows as it lands.
//
// Every movement is a spring (Motion; Brian, Nov 9: "use motion.dev to improve the texture"): the copy springs up as it
// lifts, leans with the hand's speed while held, and lands with the momentum it was let go with; the neighbours' slide
// is a stiff spring too. Under reduced motion it still lifts and the slot still shows; nothing tilts, slides or glides.

const GONE_MS = 150
/** Degrees the copy leans at full speed, and the hand speed (px/s) that is full. */
const LEAN_MAX = 2.5, LEAN_FULL_SPEED = 800
/** Without a move for this long, the hand counts as still: the lean comes back and a release carries no momentum. */
const STILL_MS = 60
/** The most of the hand's speed (px/s) that goes into the landing: enough to feel, not enough to fly past the slot. */
const CARRY_MAX = 600

/** The physics of each movement, in Motion's terms. Damping against stiffness decides what overshoots, and by how little. */
const SPRING = {
  /** Up in about 200 ms with a hair of overshoot, so the lift is felt as a pick-up and not a fade. */
  lift: { type: 'spring', stiffness: 520, damping: 32 },
  /** The lean follows the hand a beat behind it. */
  lean: { type: 'spring', stiffness: 320, damping: 26 },
  /** The landing carries the hand's momentum and settles in about 300 ms, overshooting a touch. */
  settle: { type: 'spring', stiffness: 400, damping: 34 },
  /** The neighbours get out of the way briskly, without bouncing. */
  shift: { type: 'spring', stiffness: 700, damping: 50 },
} satisfies Record<string, AnimationOptions>
/** A slide in pixels is over within half a pixel; a turn or a scale has to come all the way to rest. */
const PIXELS = { restDelta: 0.5, restSpeed: 10 }

/** A running animation: what's needed to cut it short and to know when it's done. */
type Playing = { stop(): void; finished: Promise<unknown> }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

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
 * widths. `tilt` is the copy's angle in degrees and `grow` how much bigger it gets (a wide row grows less, so its far
 * end doesn't swing out). `raise` keeps the copy that far above a finger, which would otherwise cover it; `badge` is a
 * count on it; `context`, the classes of the ancestors its styles need.
 */
export function lift(source: HTMLElement, x: number, y: number, options: { tilt?: number; grow?: number; raise?: number; badge?: string; context?: string } = {}): Lift {
  const origin = source.getBoundingClientRect()
  const tilt = options.tilt ?? 3, grow = options.grow ?? 0.02
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
  // A copy whose styles come from its place's ancestors (a dashboard widget's table): it keeps them under wrappers of
  // those classes, laid out as if they weren't there (`display: contents`), so only the selectors see them.
  if (options.context) {
    const context = document.createElement('div')
    context.className = options.context
    context.style.display = 'contents'
    context.append(body)
    body = context
  }
  const wrap = document.createElement('div')
  wrap.className = 'drag-lift'
  wrap.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('div')
  inner.className = 'drag-lift-body'
  inner.style.width = `${origin.width}px`
  inner.style.height = `${origin.height}px`
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
  // It turns about the grab point, so it stays under the pointer as it tilts and leans.
  inner.style.transformOrigin = `${grab.x}px ${grab.y}px`
  // Placed from the layout viewport, as the pointer is measured from the visible part (fixed-coords.ts).
  let pos = { left: 0, top: 0 }
  const at = (left: number, top: number) => {
    pos = { left, top: top + fixedOffset() }
    wrap.style.transform = `translate(${pos.left}px, ${pos.top}px)`
  }
  // The hand's speed in px/s, smoothed over the last moves: it leans the copy while held and carries it on release.
  const velocity = { x: 0, y: 0 }
  let last = { x, y, t: performance.now() }
  let lifted = false, lean = 0, leanRest = 0
  /** The copy's own springs, cut short if it's removed under them. */
  let playing: Playing[] = []
  const leanTo = (deg: number) => {
    if (Math.abs(deg - lean) < 0.3) return
    lean = deg
    playing.push(animate(inner, { rotate: -tilt - lean }, SPRING.lean))
  }
  const move = (px: number, py: number) => {
    const now = performance.now(), dt = now - last.t
    if (dt > 0) {
      // A move after a pause starts the estimate over; otherwise one jittery frame can't swing the copy.
      const keep = dt > 100 ? 0 : 0.5
      velocity.x = velocity.x * keep + ((px - last.x) / dt) * 1000 * (1 - keep)
      velocity.y = velocity.y * keep + ((py - last.y) / dt) * 1000 * (1 - keep)
    }
    last = { x: px, y: py, t: now }
    at(px - grab.x, py - grab.y)
    if (lifted && !reducedMotion()) {
      // Moving right, the copy trails about the hand like a card held by one corner; still, it comes back to its tilt.
      leanTo(clamp(velocity.x / LEAN_FULL_SPEED, -1, 1) * LEAN_MAX)
      clearTimeout(leanRest)
      leanRest = window.setTimeout(() => leanTo(0), STILL_MS)
    }
  }
  move(x, y)
  // Flat where it was for a frame, then up: the lift itself is seen.
  requestAnimationFrame(() => {
    lifted = true
    inner.classList.add('is-up')
    if (!reducedMotion()) playing.push(animate(inner, { rotate: -tilt, scale: 1 + grow }, SPRING.lift))
  })
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms))
  return {
    origin,
    move,
    settle(home) {
      clearTimeout(leanRest)
      inner.classList.remove('is-up')
      if (!home) { wrap.classList.add('is-gone'); return wait(GONE_MS) }
      if (reducedMotion()) { at(home.left, home.top); return Promise.resolve() }
      // Let go mid-move, it keeps some of its momentum into the slot; held still first, it just drops in.
      const still = performance.now() - last.t > STILL_MS
      const carry = (v: number) => (still ? 0 : clamp(v, -CARRY_MAX, CARRY_MAX))
      const to = { left: home.left, top: home.top + fixedOffset() }
      const glide = [
        animate(wrap, { x: [pos.left, to.left] }, { ...SPRING.settle, ...PIXELS, velocity: carry(velocity.x) }),
        animate(wrap, { y: [pos.top, to.top] }, { ...SPRING.settle, ...PIXELS, velocity: carry(velocity.y) }),
      ]
      // Flattening rides along; the last hundredth of a degree isn't waited for.
      playing.push(...glide, animate(inner, { rotate: 0, scale: 1 }, SPRING.settle))
      return Promise.all(glide.map(run => run.finished)).then(() => undefined)
    },
    remove() { for (const run of playing) run.stop(); playing = []; wrap.remove() },
  }
}

export type Rects = Map<Element, DOMRect>

/** Where each element is now, to the eye: a slide still under way counts. */
export const measure = (els: Iterable<Element>): Rects => new Map([...els].map(el => [el, el.getBoundingClientRect()]))

/** The slide each element is on, so a new one can take over from where the eye has it. */
const shifting = new WeakMap<Element, Playing>()

/** After a redraw, each element slides from where it was (`before`, measured first) to where it is now. */
export function flip(before: Rects, els: Iterable<Element>) {
  if (reducedMotion()) return
  for (const el of els) {
    const was = before.get(el)
    // Not drawn before (the lifted card), so it has nowhere to come from.
    if (!was || (!was.width && !was.height)) continue
    // Its place now, read under any slide still under way: the new slide starts where the eye had it.
    const now = layoutRect(el)
    const dx = was.left - now.left, dy = was.top - now.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
    shifting.get(el)?.stop()
    shifting.set(el, animate(el, { x: [dx, 0], y: [dy, 0] }, { ...SPRING.shift, ...PIXELS }))
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
