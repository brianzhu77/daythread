// Databases R3: the Gallery view (design §7.2): cards, 3 across or 2 on the phone, each its row's title and properties, under
// the first image in its body if it has one. Nothing uploads yet, so that image is a link to where it lives, and it can vanish:
// a card with none, or one that fails, is just its words, never a frame. A card opens its row; cards don't drag.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { firstImageUrl } from '../domain/editor-document'
import { cellValue, databaseRows, isEmptyValue, readValue, titleId, viewColumns, viewRows, type View } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { blockActions, cellKey, DatabaseHeader, pendingCells, pendingKey, setOpenCell, useAddRow, useCommitCell, useOpenRow, usePendingCells, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, type ChangeView, type DatabaseViewProps } from './database-block'
import { todayIso } from './dates'
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
  const context = useMemo(() => ({ today, pageDate }), [today, pageDate])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  usePendingCells()
  const returned = useReturnedRow(rows)
  const columns = viewColumns(db.database, view)
  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const [limit, setLimit] = useState(cap)
  const addRow = useAddRow(db, view, context, pageId => {
    const ws = latest(), at = ws ? viewRows(ws, db.id, view, context).findIndex(r => r.id === pageId) : -1
    if (at >= limit) setLimit(at + 1)
    requestAnimationFrame(() => setOpenCell({ blockId, databaseId: db.id, rowId: pageId, columnId: titleId }))
  })
  const shown = rows.slice(0, limit)

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
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('.database-gallery-title') ?? [])]
    const next = all[all.indexOf(target) + step]
    if (next) { e.preventDefault(); next.focus() }
  }

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow() }} />
    <div className="database-gallery">
      {shown.map((row, index) => {
        const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
        return <article key={row.id} data-row={row.id} className={`database-gallery-card${returned === row.id ? ' is-returned' : ''}`}>
          <CardImage row={row} />
          <div className="database-gallery-words">
            <button type="button" className={`database-gallery-title${row.title ? '' : ' is-placeholder'}`} data-nav={index === 0 ? '0:0' : undefined}
              data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId })} onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>
            {columns.map(({ property }) => {
              const pending = pendingCells.get(pendingKey(row.id, property.id))
              const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
              if (property.type === 'checkbox') return <span key={property.id} className="database-card-check"><PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{property.name}</span>
              return isEmptyValue(value) ? null : <span key={property.id} className="database-card-value"><PropertyCell property={property} value={value} today={today} /></span>
            })}
            {unsaved && <span className="database-card-unsaved">Not saved</span>}
          </div>
        </article>
      })}
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {rows.length > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    <button type="button" className="database-new" onClick={() => addRow()}>+ New</button>
  </div>
}
