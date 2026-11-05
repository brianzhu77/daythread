// A table's column heads at 1280 (R4-18): a click opens the column's menu, a drag on the edge resizes it, a drag on the head moves it.
// At 390 a head stays plain text, with Name pinned.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { columnMoved, titleId, type View } from '../domain/database'
import type { ChangeView } from './database-block'
import { closeColumnMenu, openColumnMenu, useColumnMenu } from './database-menu'

const minWidth = 60, maxWidth = 1000, lift = 4, edgeZone = 40, edgeSpeed = 14

interface Moving { id: string; name: string; x: number; y: number; line: { left: number; top: number; height: number } }

export function useColumnHeads({ wide, blockId, databaseId, view, changeView, wrap }: { wide: boolean; blockId: string; databaseId: string; view: View; changeView: ChangeView; wrap: RefObject<HTMLDivElement | null> }) {
  const [sized, setSized] = useState<{ id: string; width: number } | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  const menuColumn = useColumnMenu(blockId)
  const justDragged = useRef(false)
  const swallowClick = () => { justDragged.current = true; setTimeout(() => { justDragged.current = false }) }
  const scroll = () => wrap.current?.querySelector<HTMLElement>('.database-scroll')
  const headOf = (id: string) => scroll()?.querySelector<HTMLElement>(`[data-column-head="${CSS.escape(`${blockId}|${id}`)}"]`)
  // On the head afterwards, so ⌘Z reaches the table's Undo, not the page's text.
  const focusHead = (id: string) => headOf(id)?.querySelector<HTMLElement>('[role=button]')?.focus({ preventScroll: true })

  // A menu closing leaves focus on nothing, where ⌘Z reaches no table. Back to its head, or Name's if that column has just gone; a tap elsewhere has already put focus there.
  const hadMenu = useRef<string | undefined>(undefined)
  useEffect(() => {
    const left = hadMenu.current
    hadMenu.current = menuColumn
    if (!left || menuColumn || document.activeElement !== document.body) return
    ;(headOf(left) ?? headOf(titleId))?.querySelector<HTMLElement>('[role=button]')?.focus({ preventScroll: true })
  }, [menuColumn]) // eslint-disable-line react-hooks/exhaustive-deps

  const startResize = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    const th = headOf(id)
    if (!th) return
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX, from = Math.round(th.getBoundingClientRect().width)
    const widthAt = (x: number) => Math.max(minWidth, Math.min(maxWidth, from + Math.round(x - startX)))
    setSized({ id, width: from })
    const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc, true) }
    const move = (ev: PointerEvent) => setSized({ id, width: widthAt(ev.clientX) })
    const up = (ev: PointerEvent) => {
      finish(); swallowClick()
      const width = widthAt(ev.clientX)
      if (width !== from) changeView(current => (id === titleId ? { nameWidth: width } : { columns: current.columns.map(c => (c.id === id ? { ...c, width } : c)) }))
      setSized(null); focusHead(id)
    }
    const cancel = () => { finish(); swallowClick(); setSized(null) }
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc, true)
  }

  const startMove = (e: ReactPointerEvent<HTMLElement>, id: string, name: string) => {
    // A finger on a head scrolls the table.
    if (e.button !== 0 || e.pointerType === 'touch' || (e.target as HTMLElement).closest('.database-column-edge')) return
    const startX = e.clientX
    let lifted = false, last = { x: e.clientX, y: e.clientY }, frame = 0, drop: string | null = null
    const heads = () => [...(scroll()?.querySelectorAll<HTMLElement>('th[data-column-head]') ?? [])].filter(th => th.dataset.columnHead !== `${blockId}|${titleId}`)
    const show = () => {
      const all = heads(), first = all[0], end = all.at(-1)
      if (!first || !end) return
      const over = all.find(th => { const r = th.getBoundingClientRect(); return last.x < r.left + r.width / 2 })
      const box = scroll()!.getBoundingClientRect(), table = first.closest('table')!.getBoundingClientRect()
      const r = (over ?? end).getBoundingClientRect()
      drop = over ? over.dataset.columnHead!.slice(blockId.length + 1) : null
      setMoving({ id, name, x: last.x, y: last.y, line: { left: (over ? r.left : r.right) - 1, top: r.top, height: Math.min(table.bottom, box.bottom) - r.top } })
    }
    // Near an edge the table scrolls under the pointer, so a column off screen can still be reached. The left edge is past what stays pinned.
    const edges = () => {
      const el = scroll()
      if (el) {
        const pinned = [...el.querySelectorAll<HTMLElement>('th.is-title, th.is-frozen')].reduce((right, th) => Math.max(right, th.getBoundingClientRect().right), el.getBoundingClientRect().left)
        const by = last.x > el.getBoundingClientRect().right - edgeZone ? edgeSpeed : last.x < pinned + edgeZone ? -edgeSpeed : 0
        if (by) { el.scrollLeft += by; show() }
      }
      frame = requestAnimationFrame(edges)
    }
    const finish = () => { cancelAnimationFrame(frame); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc, true) }
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!lifted) {
        if (Math.abs(ev.clientX - startX) < lift) return
        lifted = true
        closeColumnMenu(blockId)
        frame = requestAnimationFrame(edges)
      }
      show()
    }
    const up = () => {
      finish()
      if (!lifted) return
      swallowClick()
      show()
      setMoving(null)
      const moved = columnMoved(view.columns, view.frozenThrough, id, drop)
      if (moved) changeView(current => columnMoved(current.columns, current.frozenThrough, id, drop) ?? {})
      focusHead(id)
    }
    const cancel = () => { finish(); if (lifted) swallowClick(); setMoving(null) }
    const esc = (ev: globalThis.KeyboardEvent) => { if (lifted && ev.key === 'Escape') { ev.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc, true)
  }

  const open = (id: string) => { if (!justDragged.current) openColumnMenu(blockId, databaseId, id) }

  return {
    /** The width a column is drawn at while its edge is being dragged. */
    widthOf: (id: string): number | undefined => (sized?.id === id ? sized.width : undefined),
    classOf: (id: string) => (!wide ? '' : `${moving?.id === id ? ' is-moving' : ''}${menuColumn === id ? ' is-menu-open' : ''}`),
    /** What goes on the `th`. */
    props: (id: string, name: string) => (!wide ? {} : {
      'data-column-head': `${blockId}|${id}`,
      onMouseDown: (e: MouseEvent) => e.preventDefault(),
      onClick: () => { open(id); focusHead(id) },
      ...(id === titleId ? {} : { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => startMove(e, id, name) }),
    }),
    /** What goes inside it: the words last, as the alignment gate reads them from there. */
    content: (id: string, name: string): ReactNode => (!wide ? name : <>
      <span aria-hidden="true" className={`database-column-edge${sized?.id === id ? ' is-active' : ''}`} onPointerDown={e => startResize(e, id)} onClick={e => e.stopPropagation()} />
      <span role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={menuColumn === id} className="database-column-name" onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(id) }
        // The menu's to close; the table would take it as selecting the block instead.
        if (e.key === 'Escape' && menuColumn) { e.preventDefault(); e.stopPropagation(); closeColumnMenu(blockId) }
      }}>{name}</span>
    </>),
    overlay: moving && createPortal(<>
      <div className="database-column-drop" style={{ left: moving.line.left, top: moving.line.top, height: moving.line.height }} />
      <div className="database-column-ghost" style={{ left: moving.x + 8, top: moving.y + 8 }}>{moving.name}</div>
    </>, document.body),
  }
}
