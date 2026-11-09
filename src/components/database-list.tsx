// Databases R3: the List view (design §7.2): one line per row, its title and up to 3 properties; under the title on the
// phone. A row opens as its page from anywhere on the line, as a card does. Groups fold as in a table, and rows drag by
// their ⋮⋮ while the view isn't sorted, within a group or to another.
import { formulaErrorOf } from '../domain/formula'
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { layoutRect, useRoom, withSlot } from './drag-lift'
import { sectionKey, viewSections, viewSubGroups, cellValue, databaseRows, isEmptyValue, isReadOnly, readValue, titleId, viewColumns, viewGroups, viewRows, type View } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { useSubOpen, rowTint, SubItemParent, PickedBar, useCardPicking, useRowPicking, SubGroupHead, HiddenSubGroups, NewRow, blockActions, cellKey, DatabaseHeader, GroupName, HiddenGroups, pendingCells, pendingKey, setOpenCell, shownRaw, useAddRow, useCommitCell, useFolds, useGroupLimits, useMoveRow, useOpenRow, usePendingCells, TodoTick, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, withPendingMoves, type ChangeView, type DatabaseViewProps, SubItemLead, subFoldKey, subItemTree, treeUpTo } from './database-block'
import { todayIso } from './dates'
import { ChevronRightIcon, PageEmoji } from './icons'
import { displayPageTitle } from './page-title'
import { PropertyCell, PropertyCheckbox, useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** How many properties a line shows (design §7.2): the view's first ones. Properties orders them. */
const shownProperties = 3

export function DatabaseList({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { latest } = useWorkspace()
  const commit = useCommitCell()
  const undoKey = useUndoKey()
  const wide = useWide()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const openRow = useOpenRow(view, rows, blockId)
  usePendingCells()
  const ordered = withPendingMoves(rows)
  const groups = viewGroups(db.database, view, ordered, shownRaw, weekStart)
  const placeKey = `${blockId}|${view.id}`
  const { limitOf, showMore, reach } = useGroupLimits(placeKey, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  const moveRow = useMoveRow(db, view, context, groups)
  const returned = useReturnedRow(rows)
  const columns = viewColumns(db.database, view).filter(c => c.property.id !== groups?.property.id).slice(0, shownProperties)

  const body = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const [limit, setLimit] = useState(cap)
  const open = (rowId: string, group?: string) => setOpenCell({ blockId, databaseId: db.id, rowId, columnId: titleId, ...(group !== undefined ? { group } : {}) })
  const addRow = useAddRow(db, view, context, blockId, (pageId, group) => {
    const ws = latest(), now = ws ? viewRows(ws, db.id, view, context) : []
    if (group === undefined) { const at = now.findIndex(r => r.id === pageId); if (at >= limit) setLimit(at + 1) }
    else reach(group, viewSections(db.database, view, now, undefined, weekStart)?.shown.find(g => g.key === group)?.rows.length ?? 0)
    requestAnimationFrame(() => open(pageId, group))
  })

  // Rows drag by their ⋮⋮ only while the view isn't sorted (design §7.2). The line itself lifts under the pointer, a slot
  // waits where it would land and the lines around make room (drag-lift.ts); the rows keep their order until the drop.
  type Drag = { rowId: string; before: string | null; group: string | null; height: number }
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragging = useRef<Drag | null>(null)
  const setDrag = (next: Drag | null) => { dragging.current = next; setDragState(next) }
  const room = useRoom(() => [...(body.current?.querySelectorAll('.database-list > *') ?? [])], rowId => body.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowId)}"]`) ?? null)
  const startDrag = (e: ReactPointerEvent, rowId: string, from: string | null) => {
    if (view.sort.length) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement, line = handle.closest<HTMLElement>('.database-list-row')
    if (!line) return
    handle.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY }
    let held = false
    // The line under the pointer, or a group's foot for the end of that group; read against places, not slides under way.
    const target = (y: number): { before: string | null; group: string | null } => {
      const lines = [...(body.current?.querySelectorAll<HTMLElement>('.database-list-row, .database-list-foot') ?? [])]
      const under = lines.find(l => { const r = layoutRect(l); return y < r.top + r.height / 2 })
      return { before: under?.classList.contains('database-list-row') ? under.dataset.row ?? null : null, group: (under ?? lines.at(-1))?.dataset.group ?? null }
    }
    const place = (y: number, height: number) => {
      const current = dragging.current, next = target(y)
      if (current && current.before === next.before && current.group === next.group) return
      room.willRedraw()
      setDrag({ rowId, ...next, height })
    }
    const move = (ev: PointerEvent) => {
      // A press on the handle is nothing until it moves.
      if (!held) { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return; held = true; room.pickUp(line, ev.clientX, ev.clientY, { tilt: 1 }) }
      room.copy.current?.move(ev.clientX, ev.clientY)
      place(ev.clientY, room.copy.current?.origin.height ?? line.offsetHeight)
    }
    const up = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up)
      if (!held) return
      const current = dragging.current
      if (ev.type !== 'pointercancel' && current) moveRow(rowId, from, current.group, current.before, ordered)
      setDrag(null)
      room.land(rowId)
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (undoKey(e)) return
    const target = e.target as HTMLElement
    // ⌘A on a row selects nothing: the browser's select-all would take the page around it, and the next key replace it.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    if (!target.classList.contains('database-list-title') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const all = [...(body.current?.querySelectorAll<HTMLElement>('.database-list-title') ?? [])]
    const next = all[all.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  }

  const { shut, toggleSub } = useSubOpen(blockId, view, toggle)
  const tree = subItemTree(workspace, db, view, rows, Boolean(groups), folded, shut)
  const treeOf = new Map(tree?.map(e => [e.row.id, e]))
  const picks = useRowPicking(blockId, db, view, rows, () => [...new Set([...(wrap.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].map(el => el.dataset.row!))])
  const cardPicks = useCardPicking(picks, db, wide, () => wrap.current)

  // Where Enter goes on the block selected whole (design §10), as a table's first cell.
  let line = 0
  const rowLine = (row: Page, group?: string) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    const nav = line++ === 0 ? '0:0' : undefined
    const tint = rowTint(db.database, view, row, context)
    return <div key={`${group ?? ''}:${row.id}`} data-row={row.id} {...(group !== undefined ? { 'data-group': group } : {})} {...(tint ? { style: tint.style } : {})}
      className={`database-list-row${tint ? tint.className : ''}${treeOf.get(row.id)?.context ? ' is-context' : ''}${picks.picked.includes(row.id) ? ' is-chosen' : ''}${picks.picking ? ' is-pickable' : ''}${returned === row.id ? ' is-returned' : ''}${drag?.rowId === row.id ? ' is-lifted' : ''}${room.landing === row.id ? ' is-landing' : ''}`}>
      {wide && !view.sort.length && !db.database.fixed && !treeOf.get(row.id)?.depth && <span className="database-list-handle" role="button" aria-label={`Drag ${displayPageTitle(row)}`} onPointerDown={e => startDrag(e, row.id, group ?? null)}>⋮⋮</span>}
      <TodoTick row={row} />
      {treeOf.has(row.id) && <SubItemLead entry={treeOf.get(row.id)!} label={displayPageTitle(row)} onToggle={() => toggleSub(treeOf.get(row.id)!)} />}
      <button type="button" className={`database-list-title${row.title ? '' : ' is-placeholder'}`} data-nav={nav} data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId, ...(group !== undefined ? { group } : {}) })} onClick={() => openRow(row.id)}>{row.icon && <PageEmoji icon={row.icon} className="database-row-icon" />}{row.title || 'Untitled'}{group !== undefined && <SubItemParent workspace={workspace} db={db} row={row} />}</button>
      <span className="database-list-values">
        {columns.map(({ property }) => {
          const pending = pendingCells.get(pendingKey(row.id, property.id))
          const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
          if (property.type === 'checkbox') return <span key={property.id} className="database-list-check"><PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} disabled={isReadOnly(property)} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{!wide && property.name}</span>
          return isEmptyValue(value) && !formulaErrorOf(row, property) ? null : <span key={property.id} className="database-list-value"><PropertyCell property={property} value={value} row={row} today={today} /></span>
        })}
        {unsaved && <span className="database-card-unsaved">Not saved</span>}
      </span>
    </div>
  }

  const slot = <div key="slot" className="database-list-slot drag-slot" style={{ height: drag?.height }} aria-hidden="true" />
  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown} {...cardPicks.props}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow(groups?.shown[0]?.key) }} />
    <div className={`database-list${view.wrapName ? ' wraps-name' : ''}`} ref={body}>
      {groups ? groups.shown.map(group => {
        const isFolded = folded.has(group.key)
        const subs = viewSubGroups(db.database, view, group.rows, shownRaw, weekStart)
        const body = (key: string, all: readonly Page[]) => {
          if (folded.has(key)) return null
          const shown = all.slice(0, limitOf(key))
          return <>
            {withSlot(shown, r => r.id, drag?.group === key ? drag.before : undefined, row => rowLine(row, key), slot)}
            <div className="database-list-foot" data-group={key}>
              {all.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(key)}>Show 25 more</button>}
              <span className="database-new-row"><NewRow db={db} blockId={blockId} addRow={addRow} group={key} /></span>
            </div>
          </>
        }
        return <Fragment key={group.key}>
          <div className="database-group-inner">
            <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
              <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
            </button>
          </div>
          {!isFolded && (subs && group.rows.length
            ? subs.shown.map(sub => { const key = sectionKey(group.key, sub.key); return <Fragment key={key}><SubGroupHead groups={subs} group={sub} isFolded={folded.has(key)} onToggle={() => toggle(key)} />{body(key, sub.rows)}</Fragment> })
            : body(group.key, group.rows))}
        </Fragment>
      }) : withSlot(tree ? treeUpTo(tree, limit).map(e => e.row) : ordered.slice(0, limit), r => r.id, drag && drag.group === null ? drag.before : undefined, row => rowLine(row), slot)}
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    <PickedBar picks={picks} db={db} floating />
    {cardPicks.boxDrawn}
    {groups && <HiddenGroups groups={groups} changeView={changeView} />}
    {groups && <HiddenSubGroups db={db.database} view={view} rows={ordered} changeView={changeView} weekStart={weekStart} />}
    {!groups && (tree ? tree.filter(e => e.depth === 0).length : ordered.length) > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    {!groups && <NewRow db={db} blockId={blockId} addRow={addRow} />}
  </div>
}
