// Databases R2: the Board view (design §7.2). Columns come from a Select, Status or Checkbox property; a card is a row. A
// card drags to another column by pointer at 1280 and by long-press on the phone, one `set-values` with its new place, so
// one Undo takes back both. Nothing moves in the page while dragging, only a floating copy: a redraw of the block mid-drag
// would lose the pointer.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { sectionKey, viewSections, viewSubGroups, columnCalc, propertyOf, viewBoardCalculation, canWrap, cellValue, databaseRows, isDatabase, isEmptyValue, readValue, titleId, viewColumns, viewGroups, viewRows, type View, type ViewGroup, type ViewGroups } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { SubGroupHead, HiddenSubGroups, useFolds, NewRow, shownValue, blockActions, blockPlaces, cellKey, DatabaseHeader, GroupName, HiddenGroups, pendingCells, pendingKey, setOpenCell, shownRaw, useAddRow, useCommitCell, useGroupLimits, useMoveRow, useOpenRow, usePendingCells, TodoTick, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, withPendingMoves, type ChangeView, type DatabaseViewProps } from './database-block'
import { calcText } from './property-values'
import { openDatabaseMenu } from './database-menu'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
import { PropertyCell, PropertyCheckbox } from './property-editors'
import { useWorkspace } from './use-day'

/** How long a finger holds a card still before it lifts; moving sooner is a swipe or a scroll. */
const holdMs = 350
/** A view whose property can't group any more shows all its rows in one column, under this key, and asks. */
const allKey = ''

interface Drag { rowId: string; from: string; over: string; before: string | null }

export function DatabaseBoard({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { run, latest } = useWorkspace()
  const commit = useCommitCell()
  const openRow = useOpenRow()
  const undoKey = useUndoKey()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  usePendingCells()
  const ordered = withPendingMoves(rows)
  const groups: ViewGroups | null = viewGroups(db.database, view, ordered, shownRaw, weekStart)
  const columns: ViewGroup[] = groups ? groups.shown : [{ key: allKey, name: '', rows: ordered }]
  // A column's head: its count, or the view's calculation, the same number a table's foot gives for those rows (R3-24).
  const calculation = viewBoardCalculation(db.database, view)
  const headOf = (over: readonly Page[]) => {
    const property = calculation && propertyOf(db.database, calculation.by)
    if (!calculation || !property) return over.length
    const { label, value } = calcText(calculation.kind, columnCalc(db.database, over, calculation.by, calculation.kind, (row, id) => shownValue(db.database, row, id)), property.format, today, property.prefix)
    return label ? `${label} ${value}` : value
  }
  // Each view of a block keeps its own place: a board doesn't open where a table was scrolled to.
  const placeKey = `${blockId}|${view.id}`
  const { limitOf, showMore, reach } = useGroupLimits(placeKey, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  // A second layer is a lane of the same columns across the board, their heads only on the first (R3-13).
  const laneGroups = groups ? viewSubGroups(db.database, view, ordered, shownRaw, weekStart) : null
  // With no rows and no options there are no lanes to draw, so the columns stay in reach.
  const subs = laneGroups?.shown.length ? laneGroups : null
  const moveRow = useMoveRow(db, view, context, groups)
  const returned = useReturnedRow(rows)
  const sorted = view.sort.length > 0

  const open = (rowId: string, group: string) => setOpenCell({ blockId, databaseId: db.id, rowId, columnId: titleId, group })
  const addRow = useAddRow(db, view, context, blockId, (pageId, group) => {
    const ws = latest()
    if (ws && group !== undefined) reach(group, viewSections(db.database, view, viewRows(ws, db.id, view, context), undefined, weekStart)?.shown.find(g => g.key === group)?.rows.length ?? 0)
    if (group !== undefined) requestAnimationFrame(() => open(pageId, group))
  })

  // ------------------------------------------------------------ dragging
  const board = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragging = useRef<Drag | null>(null)
  const setDrag = (next: Drag | null) => { dragging.current = next; setDragState(next) }
  const justDragged = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const placeGhost = () => { if (ghost.current) ghost.current.style.transform = `translate(${pointer.current.x + 8}px, ${pointer.current.y + 8}px)` }
  useLayoutEffect(placeGhost)

  /** The column under a point, or the nearest; in it, the card to go before. A sorted view has no place to choose. */
  const targetAt = (x: number, y: number, rowId: string): { over: string; before: string | null } | null => {
    // With lanes, the lane under the point first; a column's own height says nothing about which it's nearest.
    const lanes = [...(board.current?.querySelectorAll<HTMLElement>('.database-lane-columns') ?? [])]
    const heightFrom = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0 }
    const scope = lanes.length ? lanes.reduce((best, el) => (heightFrom(el) < heightFrom(best) ? el : best)) : board.current
    const cols = [...(scope?.querySelectorAll<HTMLElement>('[data-column]') ?? [])]
    if (!cols.length) return null
    const distance = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return x < r.left ? r.left - x : x > r.right ? x - r.right : 0 }
    const col = cols.reduce((best, el) => (distance(el) < distance(best) ? el : best))
    const cards = [...col.querySelectorAll<HTMLElement>('[data-card]')].filter(c => c.dataset.card !== rowId)
    const next = sorted ? undefined : cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2 })
    return { over: col.dataset.column!, before: next?.dataset.card ?? null }
  }
  const startCard = (e: ReactPointerEvent, row: Page, from: string) => {
    if (e.button !== 0 || (e.target as Element).closest('.property-checkbox')) return
    const touch = e.pointerType !== 'mouse'
    const start = { x: e.clientX, y: e.clientY }
    pointer.current = start
    let lifted = false, frame = 0
    const follow = () => {
      const current = dragging.current
      if (!current) return
      const target = targetAt(pointer.current.x, pointer.current.y, current.rowId)
      if (target && (target.over !== current.over || target.before !== current.before)) setDrag({ ...current, ...target })
    }
    // Near an edge the board or the page moves on, so a column or card off the screen can be reached.
    const edges = () => {
      const el = board.current
      if (el) {
        const r = el.getBoundingClientRect(), { x, y } = pointer.current
        if (x < r.left + 40) el.scrollLeft -= 10; else if (x > r.right - 40) el.scrollLeft += 10
        if (y < 90) window.scrollBy(0, -8); else if (y > window.innerHeight - 90) window.scrollBy(0, 8)
      }
      follow()
      frame = requestAnimationFrame(edges)
    }
    const lift = () => {
      lifted = true
      setDrag({ rowId: row.id, from, over: from, before: null })
      follow()
      frame = requestAnimationFrame(edges)
    }
    const hold = touch ? window.setTimeout(lift, holdMs) : 0
    const finish = () => {
      clearTimeout(hold); cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', esc, true)
    }
    const move = (ev: PointerEvent) => {
      pointer.current = { x: ev.clientX, y: ev.clientY }
      if (lifted) { placeGhost(); follow(); return }
      const far = Math.hypot(ev.clientX - start.x, ev.clientY - start.y)
      // A finger moving before the hold is up is a swipe or a scroll, and it stays the browser's.
      if (touch) { if (far > 8) finish() } else if (far > 4) lift()
    }
    const end = () => { finish(); justDragged.current = lifted; setTimeout(() => { justDragged.current = false }) }
    const up = (ev: PointerEvent) => {
      const current = dragging.current
      end(); setDrag(null)
      if (!current) return
      pointer.current = { x: ev.clientX, y: ev.clientY }
      const target = targetAt(ev.clientX, ev.clientY, current.rowId) ?? current
      moveRow(current.rowId, current.from, target.over, target.before, ordered)
    }
    const cancel = () => { end(); setDrag(null) }
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', esc, true)
  }
  // Only with a card lifted: stops iOS scrolling under the finger. It has to be there, and not passive, before the touch starts.
  useEffect(() => {
    const el = board.current
    if (!el) return
    const hold = (e: TouchEvent) => { if (dragging.current && e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', hold, { passive: false })
    return () => el.removeEventListener('touchmove', hold)
  }, [])

  // ------------------------------------------------------------ keys (design §10)
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!refocus.current) return
    const el = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(refocus.current)}"] .database-card-title`)
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); refocus.current = null }
  })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (undoKey(e)) return
    const target = e.target as HTMLElement
    // ⌘A on a card selects nothing: the browser's select-all would take the page around it, and the next key replace it.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    const card = target.closest<HTMLElement>('[data-card]')
    if (!card || target.tagName === 'INPUT') return
    const column = card.closest<HTMLElement>('[data-column]')!
    const cols = [...(column.parentElement?.querySelectorAll<HTMLElement>('[data-column]') ?? [])], c = cols.indexOf(column)
    const cards = [...column.querySelectorAll<HTMLElement>('[data-card]')], i = cards.indexOf(card)
    const focus = (el: HTMLElement | undefined) => { if (el) { e.preventDefault(); el.querySelector<HTMLElement>('.database-card-title')?.focus() } }
    const rowId = card.dataset.card!, from = column.dataset.column!
    if (e.shiftKey && e.key.startsWith('Arrow')) {
      // Shift-arrows move the card itself: to the next column, or up and down its own.
      e.preventDefault()
      refocus.current = rowId
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const to = cols[c + (e.key === 'ArrowLeft' ? -1 : 1)]?.dataset.column
        if (to !== undefined && groups) moveRow(rowId, from, to, null, ordered)
      } else if (!sorted) {
        const others = cards.map(x => x.dataset.card!)
        if (e.key === 'ArrowUp' && i > 0) moveRow(rowId, from, from, others[i - 1]!, ordered)
        if (e.key === 'ArrowDown' && i < others.length - 1) moveRow(rowId, from, from, others[i + 2] ?? null, ordered)
      }
      return
    }
    if (e.key === 'ArrowDown') focus(cards[i + 1])
    else if (e.key === 'ArrowUp') focus(cards[i - 1])
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // On to the next column with a card in it.
      const step = e.key === 'ArrowLeft' ? -1 : 1
      for (let at = c + step; at >= 0 && at < cols.length; at += step) {
        const there = [...cols[at]!.querySelectorAll<HTMLElement>('[data-card]')]
        if (there.length) { focus(there[Math.min(i, there.length - 1)]); break }
      }
    }
  }

  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)

  // Sideways scroll comes back after a redraw, as in a table.
  const scroller = (el: HTMLDivElement | null) => { board.current = el; const left = blockPlaces.get(placeKey)?.scrollLeft; if (el && left && el.scrollLeft !== left) el.scrollLeft = left }
  const onScroll = (e: UIEvent<HTMLDivElement>) => { const place = blockPlaces.get(placeKey); blockPlaces.set(placeKey, { limit: place?.limit ?? cap, ...(place?.groups ? { groups: place.groups } : {}), scrollLeft: e.currentTarget.scrollLeft }) }

  const cardColumns = viewColumns(db.database, view).filter(c => c.property.id !== groups?.property.id || c.property.type === 'multiSelect')
  const draggedRow = drag ? ordered.find(r => r.id === drag.rowId) : null
  const cardBody = (row: Page, group: string, interactive: boolean) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    return <>
      <TodoTick row={row} />
      <button type="button" tabIndex={interactive ? 0 : -1} className={`database-card-title${row.title ? '' : ' is-placeholder'}`}
        data-cell={interactive ? cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId, group }) : undefined}
        data-nav={interactive && row.id === firstCard ? '0:0' : undefined}
        onClick={() => { if (!justDragged.current) openRow(row.id) }}>{row.title || 'Untitled'}</button>
      {cardColumns.map(({ property, wrap = false }) => {
        const pending = pendingCells.get(pendingKey(row.id, property.id))
        const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
        if (property.type === 'checkbox') return <span key={property.id} className="database-card-check">
          <PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} disabled={!interactive} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{property.name}
        </span>
        if (isEmptyValue(value)) return null
        return <span key={property.id} className={`database-card-value${wrap && canWrap(property.type) ? ' is-wrapped' : ''}`}><PropertyCell property={property} value={value} today={today} wrap={wrap && canWrap(property.type)} /></span>
      })}
      {unsaved && <span className="database-card-unsaved">Not saved</span>}
    </>
  }
  // Where Enter goes on the block selected whole (design §10), as a table's first cell.
  const firstCard = columns.find(g => g.rows.length)?.rows[0]?.id
  const canAddColumn = !db.database.fixed && groups && (groups.property.type === 'select' || groups.property.type === 'status')

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow(columns[0]!.key === allKey ? undefined : columns[0]!.key) }} />
    {!groups && <p className="database-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'group')}>Group by</button></p>}
    <div className={`database-board${subs ? ' has-lanes' : ''}${drag ? ' is-dragging' : ''}`} ref={scroller} onScroll={onScroll}>
      {subs && <div className="database-lane-heads">{columns.map(c => <div key={c.key} className="database-lane-head-cell"><h3 className="database-column-head"><GroupName groups={groups!} group={c} /><span className="database-group-count">· {headOf(c.rows)}</span></h3></div>)}</div>}
      {(subs ? subs.shown : [null]).map((lane, laneIndex) => {
        const laneColumns = lane ? columns.map(c => ({ ...c, head: c, key: sectionKey(c.key, lane.key), rows: c.rows.filter(r => lane.rows.includes(r)) })) : columns.map(c => ({ ...c, head: c }))
        const laneKey = lane ? sectionKey('lane', lane.key) : ''
        const body = laneColumns.map(group => {
        const shown = group.rows.slice(0, limitOf(group.key))
        const over = drag?.over === group.key
        return <section key={group.key} className={`database-column${over && (sorted || drag!.from !== group.key) ? ' is-drop' : ''}`} data-column={group.key} aria-label={group.name ? `${group.name}, ${group.rows.length}` : 'All rows'}>
          {groups && !subs && <h3 className="database-column-head"><GroupName groups={groups} group={group.head} /><span className="database-group-count">· {headOf(group.head.rows)}</span></h3>}
          {shown.map(row => <article key={row.id} data-card={row.id}
            className={`database-card${returned === row.id ? ' is-returned' : ''}${drag?.rowId === row.id ? ' is-dragging' : ''}${over && !sorted && drag!.before === row.id && drag!.rowId !== row.id ? ' is-drop-before' : ''}`}
            // A mouse press selects no text: that would move the page's selection, and redraw this block under the drag.
            onPointerDown={e => startCard(e, row, group.key)} onMouseDown={e => { if (!(e.target as Element).closest('.property-checkbox')) e.preventDefault() }} onContextMenu={e => { if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType !== 'mouse') e.preventDefault() }}>
            {cardBody(row, group.key, true)}
          </article>)}
          {over && !sorted && drag!.before === null && <div className="database-column-drop-end" />}
          {group.rows.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(group.key)}>Show 25 more</button>}
          <NewRow db={db} blockId={blockId} addRow={addRow} {...(group.key === allKey ? {} : { group: group.key })} />
        </section>
        })
        const adding = laneIndex === 0 && canAddColumn && <AddColumn run={run} db={db} propertyId={groups!.property.id} />
        if (!lane || !subs) return <Fragment key="all">{body}{adding}</Fragment>
        return <div key={laneKey} className="database-lane">
          <SubGroupHead lane groups={subs} group={lane} isFolded={folded.has(laneKey)} onToggle={() => toggle(laneKey)} />
          {!folded.has(laneKey) && <div className="database-lane-columns">{body}{adding}</div>}
        </div>
      })}
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {groups && <HiddenGroups groups={groups} changeView={changeView} />}
    {groups && <HiddenSubGroups db={db.database} view={view} rows={ordered} changeView={changeView} weekStart={weekStart} />}
    {drag && draggedRow && createPortal(<div ref={ghost} className="database-card is-ghost" aria-hidden="true">{cardBody(draggedRow, drag.from, false)}</div>, document.body)}
  </div>
}

/** `+ Add column` at the board's end (Notion's "+ New group"): a new option of the property that makes the columns. */
function AddColumn({ run, db, propertyId }: { run: ReturnType<typeof useWorkspace>['run']; db: DatabaseViewProps['db']; propertyId: string }) {
  const [adding, setAdding] = useState(false)
  const save = (name: string) => {
    setAdding(false)
    const clean = name.trim()
    if (!clean) return
    void run(ws => {
      const now = ws.pages.find(p => p.id === db.id)
      const property = isDatabase(now) ? now.database.properties.find(p => p.id === propertyId) : undefined
      if (!property) return null
      const options = [...(property.options ?? [])], id = crypto.randomUUID()
      // A status's new option goes at the end of To do, as in its editor.
      const at = property.type === 'status' ? options.reduce((last, o, i) => ((o.group ?? 'todo') === 'todo' ? i + 1 : last), 0) : options.length
      options.splice(at, 0, { id, name: clean, ...(property.type === 'status' ? { group: 'todo' as const } : {}) })
      return { type: 'change-database', pageId: db.id, change: { kind: 'updateProperty', propertyId, options } }
    })
  }
  return <div className="database-column is-add">
    {adding
      ? <input className="database-column-name" aria-label="Column name" placeholder="Name" autoFocus onBlur={e => save(e.currentTarget.value)}
          onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.value = ''; e.currentTarget.blur() } }} />
      : <button type="button" className="database-new" onClick={() => setAdding(true)}>+ Add column</button>}
  </div>
}
