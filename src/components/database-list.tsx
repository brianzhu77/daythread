// Databases R3: the List view (design §7.2): one line per row, its title and up to 3 properties; under the title on the
// phone. A row opens as its page from anywhere on the line, as a card does. Groups fold as in a table, and rows drag by
// their ⋮⋮ while the view isn't sorted, within a group or to another.
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cellValue, databaseRows, isEmptyValue, readValue, titleId, viewColumns, viewGroups, viewRows, type View } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { blockActions, cellKey, DatabaseHeader, GroupName, HiddenGroups, pendingCells, pendingKey, setOpenCell, shownRaw, useAddRow, useCommitCell, useFolds, useGroupLimits, useMoveRow, useOpenRow, usePendingCells, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, withPendingMoves, type ChangeView, type DatabaseViewProps } from './database-block'
import { todayIso } from './dates'
import { ChevronRightIcon } from './icons'
import { displayPageTitle } from './page-title'
import { PropertyCell, PropertyCheckbox, useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** How many properties a line shows (design §7.2): the view's first ones. Properties orders them. */
const shownProperties = 3

export function DatabaseList({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { latest } = useWorkspace()
  const commit = useCommitCell()
  const openRow = useOpenRow()
  const undoKey = useUndoKey()
  const wide = useWide()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
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
  const addRow = useAddRow(db, view, context, (pageId, group) => {
    const ws = latest(), now = ws ? viewRows(ws, db.id, view, context) : []
    if (group === undefined) { const at = now.findIndex(r => r.id === pageId); if (at >= limit) setLimit(at + 1) }
    else reach(group, viewGroups(db.database, view, now, undefined, weekStart)?.shown.find(g => g.key === group)?.rows.length ?? 0)
    requestAnimationFrame(() => open(pageId, group))
  })

  // Rows drag by their ⋮⋮ only while the view isn't sorted (design §7.2), and a redraw can't lose it: nothing moves until the drop.
  const [drag, setDrag] = useState<{ rowId: string; before: string | null; group: string | null } | null>(null)
  const startDrag = (e: ReactPointerEvent, rowId: string, from: string | null) => {
    if (view.sort.length) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const target = (y: number): { before: string | null; group: string | null } => {
      const lines = [...(body.current?.querySelectorAll<HTMLElement>('.database-list-row, .database-list-foot') ?? [])]
      const line = lines.find(l => { const r = l.getBoundingClientRect(); return y < r.top + r.height / 2 })
      return { before: line?.classList.contains('database-list-row') ? line.dataset.row ?? null : null, group: (line ?? lines.at(-1))?.dataset.group ?? null }
    }
    setDrag({ rowId, ...target(e.clientY) })
    const move = (ev: PointerEvent) => setDrag({ rowId, ...target(ev.clientY) })
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (ev.type === 'pointercancel') return
      const { before, group } = target(ev.clientY)
      moveRow(rowId, from, group, before, ordered)
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
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

  // Where Enter goes on the block selected whole (design §10), as a table's first cell.
  let line = 0
  const rowLine = (row: Page, group?: string) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    const nav = line++ === 0 ? '0:0' : undefined
    return <div key={`${group ?? ''}:${row.id}`} data-row={row.id} {...(group !== undefined ? { 'data-group': group } : {})}
      className={`database-list-row${returned === row.id ? ' is-returned' : ''}${drag?.rowId === row.id ? ' is-dragging' : ''}${drag?.before === row.id && drag.rowId !== row.id && (drag.group ?? undefined) === group ? ' is-drop-before' : ''}`}>
      {wide && !view.sort.length && <span className="database-list-handle" role="button" aria-label={`Drag ${displayPageTitle(row)}`} onPointerDown={e => startDrag(e, row.id, group ?? null)}>⋮⋮</span>}
      <button type="button" className={`database-list-title${row.title ? '' : ' is-placeholder'}`} data-nav={nav} data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId, ...(group !== undefined ? { group } : {}) })} onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>
      <span className="database-list-values">
        {columns.map(({ property }) => {
          const pending = pendingCells.get(pendingKey(row.id, property.id))
          const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
          if (property.type === 'checkbox') return <span key={property.id} className="database-list-check"><PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{!wide && property.name}</span>
          return isEmptyValue(value) ? null : <span key={property.id} className="database-list-value"><PropertyCell property={property} value={value} today={today} /></span>
        })}
        {unsaved && <span className="database-card-unsaved">Not saved</span>}
      </span>
    </div>
  }

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow(groups?.shown[0]?.key) }} />
    <div className={`database-list${!groups && drag && drag.before === null ? ' is-drop-end' : ''}`} ref={body}>
      {groups ? groups.shown.map(group => {
        const isFolded = folded.has(group.key)
        const shown = isFolded ? [] : group.rows.slice(0, limitOf(group.key))
        return <Fragment key={group.key}>
          <div className="database-group-inner">
            <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
              <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
            </button>
          </div>
          {shown.map(row => rowLine(row, group.key))}
          {!isFolded && <div className={`database-list-foot${drag && drag.before === null && drag.group === group.key ? ' is-drop-end' : ''}`} data-group={group.key}>
            {group.rows.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(group.key)}>Show 25 more</button>}
            <button type="button" className="database-new" onClick={() => addRow(group.key)}>+ New</button>
          </div>}
        </Fragment>
      }) : ordered.slice(0, limit).map(row => rowLine(row))}
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {groups && <HiddenGroups groups={groups} changeView={changeView} />}
    {!groups && ordered.length > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    {!groups && <button type="button" className="database-new" onClick={() => addRow()}>+ New</button>}
  </div>
}
