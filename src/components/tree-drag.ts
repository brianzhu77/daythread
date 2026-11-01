import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// B14 (task #138, plan 9293ae5f, touch notes Jazz dc9927a5): drag a page in the sidebar tree to put it between two
// siblings or inside another page, Notion's way. Pointer events, no library: a mouse drags after 4px; a finger holds
// 400 ms without moving 8px, so a swipe still scrolls the sidebar.
//
// The tree's rows carry what a drop needs as data attributes, read at the pointer:
//   .tree-row[data-page]  data-parent (its parent's id, '' at the top level), data-depth, data-kind ('day' | 'page'),
//                         data-next (its next sibling's id, ''), data-first-child (first child's id when open, '')
//   [data-drop-top]       the "Pages" label; data-first is the first top-level page ('')

export type DropZone = 'before' | 'after' | 'inside'
/** Where a drop lands: `rowKey` is the row that shows it ('top' for the label), `depth` the level the page lands on. */
export interface Drop { rowKey: string; zone: DropZone; depth: number; parentId: string | null; beforeId: string | null }
/** True when the domain would refuse the move (its own spot, into itself, a day page…): no line, no write. */
export type Refuse = (pageId: string, parentId: string | null, beforeId: string | null) => boolean

const MOUSE_SLOP = 4, TOUCH_SLOP = 8, HOLD_MS = 400, EDGE = 32, SCROLL_STEP = 8, CHIP_LIFT = 24

export function dropAt(x: number, y: number, pageId: string, refuse: Refuse): Drop | null {
  const el = document.elementFromPoint(x, y)
  const top = el?.closest<HTMLElement>('[data-drop-top]')
  if (top) {
    const beforeId = top.dataset.first || null
    return refuse(pageId, null, beforeId) ? null : { rowKey: 'top', zone: 'after', depth: 0, parentId: null, beforeId }
  }
  const row = el?.closest<HTMLElement>('.tree-row[data-page]')
  if (!row) return null
  const d = row.dataset, id = d.page!, depth = Number(d.depth), parent = d.parent || null
  const box = row.getBoundingClientRect(), at = (y - box.top) / box.height
  const drop: Omit<Drop, 'rowKey'> =
    // A day page only takes pages inside it: days keep their own order.
    d.kind === 'day' ? { zone: 'inside', depth: depth + 1, parentId: id, beforeId: null }
    : at < 0.25 ? { zone: 'before', depth, parentId: parent, beforeId: id }
    // Below an open page is above its first child, where the line is drawn.
    : at > 0.75 ? d.firstChild ? { zone: 'after', depth: depth + 1, parentId: id, beforeId: d.firstChild } : { zone: 'after', depth, parentId: parent, beforeId: d.next || null }
    : { zone: 'inside', depth: depth + 1, parentId: id, beforeId: null }
  return refuse(pageId, drop.parentId, drop.beforeId) ? null : { rowKey: id, ...drop }
}

const sameDrop = (a: Drop | null, b: Drop | null) => a === b || Boolean(a && b && a.rowKey === b.rowKey && a.zone === b.zone && a.beforeId === b.beforeId)

export function useTreeDrag(options: { refuse: Refuse; onDrop: (pageId: string, drop: Drop) => void; scroller: () => HTMLElement | null }) {
  const [dragging, setDragging] = useState<{ pageId: string; touch: boolean } | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const opts = useRef(options); opts.current = options
  const endGesture = useRef<(() => void) | null>(null)
  useEffect(() => () => endGesture.current?.(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, title: string) => {
    if (e.button !== 0 || endGesture.current || (e.target as Element).closest('button')) return
    const pageId = e.currentTarget.dataset.page!, pointerId = e.pointerId, touch = e.pointerType === 'touch'
    const start = { x: e.clientX, y: e.clientY }
    let last = start, started = false, current: Drop | null = null, frame = 0, chip: HTMLElement | null = null
    const hold = touch ? window.setTimeout(() => begin(), HOLD_MS) : 0

    const place = () => {
      current = dropAt(last.x, last.y, pageId, opts.current.refuse)
      setDrop(prev => sameDrop(prev, current) ? prev : current)
      if (chip) chip.style.transform = `translate(${last.x}px, ${last.y - CHIP_LIFT}px) translate(-50%, -100%)`
    }
    // Near the sidebar's top or bottom edge the list scrolls under a still pointer, and the drop is read again.
    const scroll = () => {
      const box = opts.current.scroller()
      if (box) {
        const r = box.getBoundingClientRect()
        const step = last.y < r.top + EDGE ? -SCROLL_STEP : last.y > r.bottom - EDGE ? SCROLL_STEP : 0
        if (step) { const before = box.scrollTop; box.scrollTop += step; if (box.scrollTop !== before) place() }
      }
      frame = requestAnimationFrame(scroll)
    }
    const begin = () => {
      started = true
      setDragging({ pageId, touch })
      if (touch) {
        navigator.vibrate?.(10)
        // The finger covers the row: a chip with the title rides above it (touch only).
        chip = document.createElement('div')
        chip.className = 'tree-drag-chip'
        chip.textContent = title
        document.body.append(chip)
      }
      place()
      frame = requestAnimationFrame(scroll)
    }
    const end = (commit: boolean) => {
      clearTimeout(hold); cancelAnimationFrame(frame); chip?.remove()
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', touchMove); window.removeEventListener('keydown', key, true); window.removeEventListener('contextmenu', noMenu, true)
      endGesture.current = null
      if (!started) return
      // The release would also click the row's link and open the page.
      const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
      window.addEventListener('click', swallow, true)
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      setDragging(null); setDrop(null)
      if (commit && current) opts.current.onDrop(pageId, current)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      last = { x: ev.clientX, y: ev.clientY }
      if (!started) {
        const far = Math.hypot(last.x - start.x, last.y - start.y)
        if (touch) { if (far > TOUCH_SLOP) end(false); return }
        if (far <= MOUSE_SLOP) return
        begin()
      }
      place()
    }
    const up = (ev: PointerEvent) => { if (ev.pointerId === pointerId) end(true) }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) end(false) }
    // Once a finger drag has begun, the page must not scroll under it (the list scrolls itself at the edges).
    const touchMove = (ev: TouchEvent) => { if (started && ev.cancelable) ev.preventDefault() }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && started) { ev.preventDefault(); ev.stopPropagation(); end(false) } }
    // iOS's own long-press (link preview, callout) would fight the hold.
    const noMenu = (ev: Event) => ev.preventDefault()

    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', touchMove, { passive: false }); window.addEventListener('keydown', key, true)
    if (touch) window.addEventListener('contextmenu', noMenu, true)
    endGesture.current = () => end(false)
  }

  return { dragging, drop, onPointerDown }
}
