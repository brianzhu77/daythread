// Moving lines on a phone (Brian 2026-11-08): a long press anywhere on a line picks it up, a heading with its section as
// on a desktop; a chip with its words rides above the finger, the held lines dim where they were, a line shows where they
// will land, and nothing else on the page changes; they land where the finger lets go, at any depth.
import { useEffect, useRef } from 'react'
import type { DropPlace } from '../domain/line-move'
import { fixedOffset } from './fixed-coords'

export interface LineDrop { id: string; place: DropPlace; top: number; left: number; right: number }

const outerOf = (el: Element | null | undefined) => el?.closest<HTMLElement>('.bn-block-outer[data-id]') ?? null
/** A block's own line, without the lines nested under it. */
const ownLine = (outer: HTMLElement) => (outer.querySelector<HTMLElement>(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content') ?? outer).getBoundingClientRect()
/** Lines inside a synced block or a view belong to it: a drop beside one lands beside the block itself. */
const landingOf = (outer: HTMLElement): HTMLElement => {
  let at = outer, up = outerOf(outer.parentElement)
  while (up) { if (up.querySelector(':scope > .bn-block > .react-renderer > .bn-block-content[data-content-type="syncedBlock"], :scope > .bn-block > .react-renderer > .bn-block-content[data-content-type="database"]')) at = up; up = outerOf(up.parentElement) }
  return at
}

/** Where lines dropped at (x, y) land: read across the text column, so a finger near either edge still names its line. */
export function dropAt(root: HTMLElement, x: number, y: number, held: ReadonlySet<string>): LineDrop | null {
  const column = root.querySelector('.bn-editor')?.getBoundingClientRect()
  const probe = column ? Math.min(Math.max(x, column.left + 56), column.right - 16) : x
  let outer = outerOf(document.elementFromPoint(probe, y))
  if (!outer || !root.contains(outer)) {
    // Between lines or past the ends: the nearest line.
    const all = [...root.querySelectorAll<HTMLElement>('.bn-editor > .bn-block-group > .bn-block-outer[data-id]')]
    outer = all.find(o => o.getBoundingClientRect().bottom > y) ?? all.at(-1) ?? null
  }
  if (!outer) return null
  outer = landingOf(outer)
  for (let at: HTMLElement | null = outer; at; at = outerOf(at.parentElement)) if (held.has(at.dataset.id!)) return null
  const line = ownLine(outer), box = outer.getBoundingClientRect(), right = column?.right ?? box.right
  const below = y > line.top + line.height / 2
  // Below a line with lines nested under it is above the first of those, which is where the line is drawn.
  const first = below ? outer.querySelector<HTMLElement>(':scope > .bn-block > .bn-block-group > .bn-block-outer[data-id]') : null
  if (first && !held.has(first.dataset.id!)) return { id: first.dataset.id!, place: 'before', top: ownLine(first).top, left: ownLine(first).left, right }
  return below ? { id: outer.dataset.id!, place: 'after', top: box.bottom, left: line.left, right } : { id: outer.dataset.id!, place: 'before', top: line.top, left: line.left, right }
}

const HOLD_MS = 400, SLOP = 8, CHIP_LIFT = 28

/** What's held, in words, riding above the finger that covers it. */
export function dragChip(label: string): { at(x: number, y: number): void; remove(): void } {
  const chip = document.createElement('div')
  chip.className = 'line-drag-chip'
  chip.textContent = label
  document.body.append(chip)
  // Placed from the layout viewport, as the finger is measured from the visible part (fixed-coords.ts).
  return { at: (x, y) => { chip.style.transform = `translate(${x}px, ${y + fixedOffset() - CHIP_LIFT}px) translate(-50%, -100%)` }, remove: () => chip.remove() }
}

/**
 * A finger held still on a line for 400 ms starts a drag; moving more than 8 px first is a scroll or a selection, and a
 * short press is a tap, both left to the browser. Once started, the page doesn't scroll under the finger (`edge` does,
 * near the top and bottom), iOS's own long-press menu is kept off, and the release's click goes nowhere.
 */
export function useLineHold(root: () => HTMLElement | null, handlers: {
  /** The line pressed: what to hold and the chip's words, or null to leave this press alone. */
  pick(blockId: string): { ids: string[]; label: string } | null
  begin(ids: string[]): void
  move(x: number, y: number): void
  end(commit: boolean): void
}) {
  const h = useRef(handlers); h.current = handlers
  useEffect(() => {
    const el = root()
    if (!el) return
    let gesture: (() => void) | null = null
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary || gesture) return
      const target = e.target as HTMLElement
      // Controls keep their own taps and holds: a view's rows, a checkbox, a button, the line's own grip.
      if (target.closest('input, button, select, textarea, .database-block, .editor-touch-handle, [data-content-type="database"]')) return
      const outer = outerOf(target)
      if (!outer || !el.contains(outer)) return
      const picked = h.current.pick(landingOf(outer).dataset.id!)
      if (!picked) return
      const start = { x: e.clientX, y: e.clientY }, pointerId = e.pointerId
      let last = start, started = false, chip: ReturnType<typeof dragChip> | null = null, frame = 0
      const place = () => { chip?.at(last.x, last.y); h.current.move(last.x, last.y) }
      // Each frame, so a finger held still near the top or bottom keeps the page scrolling and the line follows.
      const tick = () => { place(); frame = requestAnimationFrame(tick) }
      const begin = () => {
        started = true
        // No text selection or loupe from here on: this press is a drag.
        document.body.classList.add('is-line-held')
        // A selection made by the press goes; a caret stays, as taking it would drop the keyboard and move the page mid-drag.
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) selection.collapseToStart()
        navigator.vibrate?.(10)
        chip = dragChip(picked.label)
        h.current.begin(picked.ids)
        tick()
      }
      const hold = window.setTimeout(begin, HOLD_MS)
      const at = (x: number, y: number) => {
        last = { x, y }
        if (!started && Math.hypot(x - start.x, y - start.y) > SLOP) stop(false)
      }
      const stop = (commit: boolean) => {
        clearTimeout(hold); cancelAnimationFrame(frame); chip?.remove(); document.body.classList.remove('is-line-held')
        window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerCancel)
        window.removeEventListener('touchmove', touchMove); window.removeEventListener('touchend', touchEnd); window.removeEventListener('touchcancel', touchCancel)
        window.removeEventListener('contextmenu', noMenu, true); document.removeEventListener('selectstart', noSelect, true); document.removeEventListener('selectionchange', unselect)
        gesture = null
        if (!started) return
        const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
        window.addEventListener('click', swallow, true)
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
        h.current.end(commit)
      }
      // A held finger is followed by its touch events: Chromium stops a touch's pointer events once it would pan, even when
      // the pan is refused, while touch events go on and can refuse it. Pointer moves count too, where they arrive.
      const touchMove = (ev: TouchEvent) => {
        const t = ev.touches[0]
        if (t) at(t.clientX, t.clientY)
        if (started && ev.cancelable) ev.preventDefault()
      }
      const touchEnd = (ev: TouchEvent) => { if (!ev.touches.length) stop(true) }
      const touchCancel = () => stop(false)
      const pointerMove = (ev: PointerEvent) => { if (ev.pointerId === pointerId) at(ev.clientX, ev.clientY) }
      const pointerUp = (ev: PointerEvent) => { if (ev.pointerId === pointerId) stop(true) }
      // Before the hold, a cancel is the browser scrolling: let it. After, the touch events carry on.
      const pointerCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId && !started) stop(false) }
      const noMenu = (ev: Event) => ev.preventDefault()
      const noSelect = (ev: Event) => { if (started) ev.preventDefault() }
      // iOS still selects a word at about 650 ms, on its own timer; while a line is held, that selection goes at once.
      const unselect = () => { const selection = window.getSelection(); if (started && selection && !selection.isCollapsed) selection.removeAllRanges() }
      document.addEventListener('selectstart', noSelect, true); document.addEventListener('selectionchange', unselect)
      window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerCancel)
      window.addEventListener('touchmove', touchMove, { passive: false }); window.addEventListener('touchend', touchEnd); window.addEventListener('touchcancel', touchCancel)
      window.addEventListener('contextmenu', noMenu, true)
      gesture = () => stop(false)
    }
    el.addEventListener('pointerdown', down, true)
    return () => { el.removeEventListener('pointerdown', down, true); gesture?.() }
  }, [root])
}
