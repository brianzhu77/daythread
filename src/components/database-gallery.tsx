// Databases R3: the Gallery view (design §7.2): cards, 3 across or 2 on the phone, each its row's title and properties, under
// the first image in its body if it has one. Nothing uploads yet, so that image is a link to where it lives, and it can vanish:
// a card with none, or one that fails, is just its words, never a frame. A card opens its row; cards don't drag. Groups fold as in
// a list, each with its own cards, `+ New` and cap.
import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { firstImageUrl } from '../domain/editor-document'
import { sectionKey, viewSections, viewSubGroups, canWrap, cellValue, databaseRows, isEmptyValue, readValue, titleId, viewColumns, viewGroups, viewRows, type View } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { SubGroupHead, HiddenSubGroups, NewRow, blockActions, cellKey, DatabaseHeader, GroupName, HiddenGroups, pendingCells, pendingKey, setOpenCell, shownRaw, useAddRow, useCommitCell, useFolds, useGroupLimits, useOpenRow, usePendingCells, TodoTick, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, withPendingMoves, type ChangeView, type DatabaseViewProps } from './database-block'
import { todayIso } from './dates'
import { ChevronRightIcon } from './icons'
import { displayPageTitle } from './page-title'
import { PropertyCell, PropertyCheckbox, useWide } from './property-editors'
import { useWorkspace } from './use-day'

function CardImage({ row }: { row: Page }) {
  const url = useMemo(() => firstImageUrl(row), [row.document]) // eslint-disable-line react-hooks/exhaustive-deps
  const [failed, setFailed] = useState<string | null>(null)
  if (!url || failed === url) return null
  return <img className="database-gallery-image" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(url)} />
}

export function DatabaseGallery({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
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
  const returned = useReturnedRow(rows)
  const viewColumnsShown = viewColumns(db.database, view)
  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const [limit, setLimit] = useState(cap)
  const groups = viewGroups(db.database, view, withPendingMoves(rows), shownRaw, weekStart)
  const { limitOf, showMore, reach } = useGroupLimits(`${blockId}|${view.id}`, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  const addRow = useAddRow(db, view, context, blockId, (pageId, group) => {
    const ws = latest(), now = ws ? viewRows(ws, db.id, view, context) : []
    if (group === undefined) { const at = now.findIndex(r => r.id === pageId); if (at >= limit) setLimit(at + 1) }
    else reach(group, viewSections(db.database, view, now, undefined, weekStart)?.shown.find(g => g.key === group)?.rows.length ?? 0)
    requestAnimationFrame(() => setOpenCell({ blockId, databaseId: db.id, rowId: pageId, columnId: titleId, ...(group !== undefined ? { group } : {}) }))
  })

  // Where Enter goes on the block selected whole (design §10), as a table's first cell.
  let drawn = 0
  const card = (row: Page, group?: string) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    const nav = drawn++ === 0 ? '0:0' : undefined
    return <article key={row.id} data-row={row.id} className={`database-gallery-card${returned === row.id ? ' is-returned' : ''}`}>
      <CardImage row={row} />
      <div className="database-gallery-words">
        <TodoTick row={row} />
        <button type="button" className={`database-gallery-title${row.title ? '' : ' is-placeholder'}`} data-nav={nav}
          data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId, ...(group !== undefined ? { group } : {}) })} onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>
        {viewColumnsShown.map(({ property, wrap = false }) => {
          const pending = pendingCells.get(pendingKey(row.id, property.id))
          const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
          if (property.type === 'checkbox') return <span key={property.id} className="database-card-check"><PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{property.name}</span>
          return isEmptyValue(value) ? null : <span key={property.id} className={`database-card-value${wrap && canWrap(property.type) ? ' is-wrapped' : ''}`}><PropertyCell property={property} value={value} today={today} wrap={wrap && canWrap(property.type)} /></span>
        })}
        {unsaved && <span className="database-card-unsaved">Not saved</span>}
      </div>
    </article>
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (undoKey(e)) return
    const target = e.target as HTMLElement
    // ⌘A on a card selects nothing: the browser's select-all would take the page around it, and the next key replace it.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    if (!target.classList.contains('database-gallery-title')) return
    const across = wide ? 3 : 2
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[e.key]
    if (!step) return
    // Within its own group's cards, and on to the next group's first or the last one's last when that runs out.
    const here = [...(target.closest('.database-gallery')?.querySelectorAll<HTMLElement>('.database-gallery-title') ?? [])]
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('.database-gallery-title') ?? [])]
    const next = here[here.indexOf(target) + step] ?? all[all.indexOf(target) + Math.sign(step)]
    if (next) { e.preventDefault(); next.focus() }
  }

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow() }} />
    {groups ? groups.shown.map(group => {
      const isFolded = folded.has(group.key)
      const subs = viewSubGroups(db.database, view, group.rows, shownRaw, weekStart)
      const body = (key: string, all: readonly Page[]) => {
        if (folded.has(key)) return null
        const shown = all.slice(0, limitOf(key))
        return <>
          {shown.length > 0 && <div className="database-gallery">{shown.map(row => card(row, key))}</div>}
          {all.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(key)}>Show 25 more</button>}
          <span className="database-new-row"><NewRow db={db} blockId={blockId} addRow={addRow} group={key} className="database-new is-under-cards" /></span>
        </>
      }
      return <Fragment key={group.key}>
        <div className="database-group-inner">
          <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
            <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
          </button>
        </div>
        {!isFolded && (subs
          ? subs.shown.map(sub => { const key = sectionKey(group.key, sub.key); return <Fragment key={key}><SubGroupHead groups={subs} group={sub} isFolded={folded.has(key)} onToggle={() => toggle(key)} />{body(key, sub.rows)}</Fragment> })
          : body(group.key, group.rows))}
      </Fragment>
    }) : <div className="database-gallery">{rows.slice(0, limit).map(row => card(row))}</div>}
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {groups && <HiddenGroups groups={groups} changeView={changeView} underCards />}
    {groups && <HiddenSubGroups db={db.database} view={view} rows={rows} changeView={changeView} weekStart={weekStart} underCards />}
    {!groups && rows.length > limit && <button type="button" className="database-more is-under-cards" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    {!groups && <NewRow db={db} blockId={blockId} addRow={addRow} className="database-new is-under-cards" />}
  </div>
}
