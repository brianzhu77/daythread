// Databases R1 (design §4, §6, §10, §13): the `database` block in a page. Only a database's home block draws its table;
// any other block pointing at a database (a paste, an old copy, one left behind by Move to…) is a page card to it until
// linked views ship in R2 (Roadbuster 220ae60e). Cells edit through Jazz's value editors (property-editors.tsx); each
// commit is one `set-values` with its per-cell check (model §5.2).
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type SyntheticEvent, type UIEvent } from 'react'
import { cellValue, databaseRows, isDatabase, isEmptyValue, newRowValues, propertyOf, rawOf, sameRaw, titleId, viewColumns, viewRows, type CellValue, type Database, type Json, type Property, type View } from '../domain/database.ts'
import type { Page, Workspace } from '../domain/types'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
import { ChevronDownIcon } from './icons'
import { PropertyCell, PropertyCheckbox, PropertyEditor } from './property-editors'
import { useWorkspace } from './use-day'

const newId = (): string => crypto.randomUUID()
/** Rows drawn before "Show 25 more" (design §13): inline, and on the full page. */
export const rowCaps = { inline: 25, page: 100 } as const
const titleProperty: Property = { id: titleId, name: 'Name', type: 'text' }

/** Keys, input and pointer presses inside the block never reach the page editor (design §10). */
const isolate = { onKeyDown: stop, onKeyUp: stop, onKeyPress: stop, onBeforeInput: stop, onInput: stop, onPaste: stop, onCut: stop, onCopy: stop, onCompositionStart: stop, onCompositionUpdate: stop, onCompositionEnd: stop, onMouseDown: stop, onPointerDown: stop, onDrop: stop, onDragOver: stop }
function stop(e: SyntheticEvent) { e.stopPropagation() }

/** The view a block shows on this device: a local preference per block, never a save (Lead 7b3b9664). */
function viewKey(blockId: string) { return `daythread.database-view.${blockId}` }
export function shownView(db: Database, blockId: string): View {
  let id: string | null = null
  try { id = localStorage.getItem(viewKey(blockId)) } catch { /* private mode */ }
  return db.views.find(v => v.id === id) ?? db.views[0]!
}

/** Databases being made by `/` Database in this tab: the block shows "Creating…", then "Not created · Retry". */
type Pending = { state: 'creating' | 'failed'; retry: () => void }
const pendingDatabases = new Map<string, Pending>()
const pendingListeners = new Set<() => void>()
let pendingVersion = 0
export function setDatabasePending(pageId: string, pending: Pending | null) {
  if (pending) pendingDatabases.set(pageId, pending); else pendingDatabases.delete(pageId)
  pendingVersion++
  for (const l of pendingListeners) l()
}
function usePendingDatabases() {
  return useSyncExternalStore(l => { pendingListeners.add(l); return () => pendingListeners.delete(l) }, () => pendingVersion, () => 0)
}

export function DatabaseBlock({ blockId, pageId, hostDate }: { blockId: string; pageId: string; hostDate: string | null }) {
  const { workspace } = useWorkspace()
  usePendingDatabases()
  const db = workspace?.pages.find(p => p.id === pageId)
  const pending = db ? undefined : pendingDatabases.get(pageId)
  if (pending) return <div className="database-block is-pending" contentEditable={false} {...isolate}>
    <div className="database-title-row"><span className="database-title is-placeholder">Untitled database</span></div>
    {pending.state === 'creating' ? <p className="database-empty">Creating…</p>
      : <button type="button" className="database-new" onClick={pending.retry}>Not created · Retry</button>}
  </div>
  if (!workspace || !isDatabase(db) || db.database.homeBlockId !== blockId || db.trashedAt) return <DatabaseCard pageId={pageId} />
  return <div className="database-block" contentEditable={false} {...isolate}>
    <DatabaseTable workspace={workspace} db={db} blockId={blockId} pageDate={hostDate} cap={rowCaps.inline} />
  </div>
}

/** The page card for a database block that isn't its home (or whose database is gone or in the trash). */
export function DatabaseCard({ pageId }: { pageId: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const db = workspace?.pages.find(p => p.id === pageId)
  const rows = workspace && isDatabase(db) ? databaseRows(workspace, db.id).length : 0
  return <span className="editor-page-card-row" contentEditable={false}>
    <button type="button" className={`editor-page-card ${db?.trashedAt ? 'in-trash' : ''}`} disabled={!db}
      onClick={() => void navigate({ to: '/pages', search: { page: pageId } })}>
      <span className="editor-page-card-icon" aria-hidden>▦</span>
      <span className="editor-page-card-text">
        <span className="editor-page-card-title">{db ? displayPageTitle(db) : 'Database not found'}</span>
        {db && <span className="editor-page-card-preview">Database · {rows} row{rows === 1 ? '' : 's'}</span>}
      </span>
      {db?.trashedAt && <span className="in-trash-tag">In trash</span>}
    </button>
  </span>
}

// ---------------------------------------------------------------- the open cell editor
// The editor a cell opens lives outside the page editor's block (DatabaseCellEditor, mounted once by the app shell):
// BlockNote may draw a block again (a remount, losing its state) whenever the page editor's focus or selection changes,
// which an editor taking the focus does at once. Only which cell is open is shared, here.

export interface OpenCell { blockId: string; databaseId: string; rowId: string; columnId: string }
let openCell: OpenCell | null = null
const cellListeners = new Set<() => void>()
function setOpenCell(next: OpenCell | null) { openCell = next; for (const l of cellListeners) l() }
function useOpenCell(): OpenCell | null {
  return useSyncExternalStore(l => { cellListeners.add(l); return () => cellListeners.delete(l) }, () => openCell, () => null)
}
const cellKey = (c: OpenCell) => `${c.blockId}|${c.rowId}|${c.columnId}`
/** Operations already resent once after "Saved elsewhere" (model §5.2: once, never in a loop). */
const resent = new Set<string>()

/** What a block's table keeps across BlockNote's redraws (by block id, for this tab): where it was scrolled, rows shown. */
const blockPlaces = new Map<string, { scrollLeft: number; limit: number }>()

/** One cell's commit: sent with what the cell held, resent once after "Saved elsewhere" if that cell is unchanged. */
function useCommitCell() {
  const { run, refresh } = useWorkspace()
  const commit = (db: Page & { database: Database }, row: Page, columnId: string, raw: Json | undefined, notice?: string) => {
    const expected = (rawOf(row, columnId) ?? null) as Json
    const values = { [columnId]: raw ?? null } as Record<string, Json>
    const property = propertyOf(db.database, columnId) ?? titleProperty
    const send = (operationId = newId()) => run(
      { type: 'set-values', pageId: row.id, values, expected: { [columnId]: expected }, at: new Date().toISOString() },
      notice ? r => ({ text: notice, undoOperationId: r.operationId }) : null, operationId,
      { inlineRefusal: /Saved elsewhere|Changed elsewhere/, onRefused: () => void again(operationId) })
    const again = async (operationId: string) => {
      const fresh = await refresh()
      const now = fresh.pages.find(p => p.id === row.id)
      // A row deleted meanwhile: his value goes quietly (Bumblebee 3c5198d5).
      if (!now || now.trashedAt) return
      if (sameRaw(rawOf(now, columnId), expected) && !resent.has(operationId)) { resent.add(operationId); void send(); return }
      // One wording everywhere (Lead 0b05067c, design §13).
      const mine = typeof raw === 'string' ? `“${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}”` : raw === undefined ? 'empty' : String(raw)
      const key: string = toast(`${property.name} in ${displayPageTitle(now)} changed elsewhere · yours was ${mine}`, {
        timeout: 10_000, actionProps: { children: 'Use mine', onPress: () => { toast.close(key); commit(db, now, columnId, raw) } },
      })
    }
    void send()
  }
  return commit
}

/** Mounted once (app shell): the editor of the open cell, under its cell, or as a sheet on the phone. */
export function DatabaseCellEditor() {
  const { workspace, run } = useWorkspace()
  const cell = useOpenCell()
  const commit = useCommitCell()
  const db = cell ? workspace?.pages.find(p => p.id === cell.databaseId) : undefined
  const row = cell ? workspace?.pages.find(p => p.id === cell.rowId) : undefined
  const property = cell && isDatabase(db) ? (cell.columnId === titleId ? titleProperty : propertyOf(db.database, cell.columnId)) : null
  // The cell itself, found again whenever the block is drawn again, so the popover stays under it.
  const find = () => cell ? document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellKey(cell))}"]`) : null
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!cell) return
    let frame = 0
    const check = () => { const el = find(); setAnchor(a => (a === el ? a : el)); frame = requestAnimationFrame(check) }
    check()
    return () => cancelAnimationFrame(frame)
  }, [cell]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!cell || !isDatabase(db) || !row || row.trashedAt || !property || !anchor) return null
  const value = cell.columnId === titleId ? (row.title || null) : cellValue(db.database, row, cell.columnId)
  return <PropertyEditor key={cellKey(cell)}
    property={property} value={value as CellValue} rowTitle={displayPageTitle(row)} anchor={anchor}
    onCommit={(raw, info) => { setOpenCell(null); commit(db, row, cell.columnId, cell.columnId === titleId ? (raw ?? '') : raw, info?.notice) }}
    onCancel={() => setOpenCell(null)}
    onCreateOption={name => createOption(run, db, property, name)} />
}

function createOption(run: ReturnType<typeof useWorkspace>['run'], db: Page & { database: Database }, property: Property, name: string): string {
  const id = newId()
  const current = db.database.properties.find(p => p.id === property.id) ?? property
  const options = [...(current.options ?? [])]
  // Status: a new option goes at the end of To do (Jazz bf91cb72).
  const at = property.type === 'status' ? options.reduce((last, o, i) => (o.group ?? 'todo') === 'todo' ? i + 1 : last, 0) : options.length
  options.splice(at, 0, { id, name, ...(property.type === 'status' ? { group: 'todo' as const } : {}) })
  void run({ type: 'change-database', pageId: db.id, change: { kind: 'updateProperty', propertyId: property.id, options } })
  return id
}

/** The table view (design §4.1, §4.2): Name first, then the view's shown properties; `+ New` under the rows. */
export function DatabaseTable({ workspace, db, blockId, pageDate, cap, showTitle = true }: { workspace: Workspace; db: Page & { database: Database }; blockId: string; pageDate: string | null; cap: number; showTitle?: boolean }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  const commit = useCommitCell()
  const today = todayIso()
  const view = shownView(db.database, blockId)
  const context = useMemo(() => ({ today, pageDate }), [today, pageDate])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const columns = viewColumns(db.database, view)
  const place = blockPlaces.get(blockId)
  const [limit, setLimitState] = useState(place?.limit ?? cap)
  const setLimit = (next: number) => { setLimitState(next); blockPlaces.set(blockId, { scrollLeft: blockPlaces.get(blockId)?.scrollLeft ?? 0, limit: next }) }
  // Sideways scroll comes back after a redraw, so an edit never sends him back to Name (Jazz 8985f9e7).
  const scroller = (el: HTMLDivElement | null) => { const left = blockPlaces.get(blockId)?.scrollLeft; if (el && left && el.scrollLeft !== left) el.scrollLeft = left }
  const onScroll = (e: UIEvent<HTMLDivElement>) => blockPlaces.set(blockId, { limit, scrollLeft: e.currentTarget.scrollLeft })
  const open = (rowId: string, columnId: string) => setOpenCell({ blockId, databaseId: db.id, rowId, columnId })
  const key = (rowId: string, columnId: string) => cellKey({ blockId, databaseId: db.id, rowId, columnId })

  const addRow = () => {
    const prefill = newRowValues(db.database, view, context)
    const pageId = newId()
    void run({ type: 'add-row', databaseId: db.id, pageId, title: prefill.title, values: prefill.values, at: new Date().toISOString() },
      r => prefill.visible ? null : { text: "Added · hidden by this view's filter", extra: { label: 'Show', run: () => void navigate({ to: '/pages', search: { page: r.entityId ?? pageId } }) } })
      // A new row opens its Name to be typed (design §3.1), once it's drawn.
      .then(r => { if (r && prefill.visible) requestAnimationFrame(() => open(pageId, titleId)) })
  }
  const addProperty = () => {
    const name = uniqueName(db.database)
    void run({ type: 'change-database', pageId: db.id, change: { kind: 'addProperty', property: { id: newId(), name, type: 'text' }, viewId: view.id } })
  }
  const rename = (title: string) => { if (title !== db.title) void run({ type: 'rename-page', pageId: db.id, title }) }

  const shown = rows.slice(0, limit)
  return <div className="database-table-wrap">
    {showTitle && <div className="database-title-row">
      <input className="database-title" data-database={db.id} aria-label="Database name" placeholder="Untitled database" defaultValue={db.title} key={db.title}
        onBlur={e => rename(e.currentTarget.value.trim())}
        // Enter in a new database's title goes on to its first row's Name (design §3.1).
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.currentTarget.blur(); if (!databaseRows(workspace, db.id).length) addRow() } }} />
      <span className="database-view-name">{view.name}<ChevronDownIcon /></span>
    </div>}
    <div className="database-scroll" ref={scroller} onScroll={onScroll}>
      <table className="database-table">
        <thead>
          <tr>
            <th scope="col" className="database-th is-title" data-type="title">Name</th>
            {columns.map(c => <th key={c.property.id} scope="col" className="database-th" data-type={c.property.type} style={{ width: c.width ?? defaultWidth(c.property) }}>{c.property.name}</th>)}
            <th scope="col" className="database-th is-add"><button type="button" aria-label="Add property" onClick={addProperty}>+</button></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(row => <tr key={row.id} className="database-row">
            <td className="database-td is-title"><div className="database-title-inner">
              {/* A row opens as a page, from Name, at both widths (design §5). */}
              <button type="button" className="database-title-cell" data-cell={key(row.id, titleId)} onClick={() => void navigate({ to: '/pages', search: { page: row.id } })}>
                <span className={row.title ? '' : 'is-placeholder'}>{row.title || 'Untitled'}</span>
              </button>
              <button type="button" className="database-open" onClick={() => void navigate({ to: '/pages', search: { page: row.id } })}>Open</button>
            </div></td>
            {columns.map(({ property }) => {
              const value = cellValue(db.database, row, property.id)
              return <td key={property.id} className={`database-td is-${property.type}`}>
                {property.type === 'checkbox'
                  ? <PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />
                  : <button type="button" className="database-cell" data-cell={key(row.id, property.id)} onClick={() => open(row.id, property.id)}>
                      <PropertyCell property={property} value={value} today={today} />
                    </button>}
              </td>
            })}
            <td className="database-td is-add" />
          </tr>)}
        </tbody>
      </table>
    </div>
    {rows.length === 0 && view.filter.length > 0 && <p className="database-empty">No rows match this view</p>}
    {rows.length > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    <button type="button" className="database-new" onClick={addRow}>+ New</button>
  </div>
}

/** Column widths until he drags one (stored on the view), design §4.1. Name's width is in CSS: 240, or 150 on the phone. */
function defaultWidth(property: Property): number {
  switch (property.type) {
    case 'checkbox': return 60
    case 'number': return 90
    case 'date': return 110
    case 'select': case 'multiSelect': case 'status': return 140
    case 'text': case 'url': return 180
  }
}
/** "Property", "Property 2", …: never a name the database already has (or "Name"). */
function uniqueName(db: Database): string {
  const taken = new Set(['name', ...db.properties.map(p => p.name.toLocaleLowerCase())])
  for (let n = 1; ; n++) { const name = n === 1 ? 'Property' : `Property ${n}`; if (!taken.has(name.toLocaleLowerCase())) return name }
}

/** The full page of a database (design §4.3): the page's own title above, the table, no body. */
export function DatabasePage({ workspace, db }: { workspace: Workspace; db: Page & { database: Database } }) {
  return <div className="database-block is-page"><DatabaseTable workspace={workspace} db={db} blockId={`page:${db.id}`} pageDate={null} cap={rowCaps.page} showTitle={false} /></div>
}

/** A row's properties above its body (design §5): one line each; more than 4 empty ones fold into one line. */
export function RowProperties({ workspace, row, db }: { workspace: Workspace; row: Page; db: Page & { database: Database } }) {
  const { run } = useWorkspace()
  const commit = useCommitCell()
  const [unfolded, setUnfolded] = useState(false)
  const today = todayIso()
  const blockId = `row:${row.id}`
  const properties = db.database.properties
  const empty = properties.filter(p => isEmptyValue(cellValue(db.database, row, p.id)) && p.type !== 'checkbox' && p.type !== 'status')
  const fold = !unfolded && empty.length > 4
  const shown = fold ? properties.filter(p => !empty.includes(p)) : properties
  const addProperty = () => void run({ type: 'change-database', pageId: db.id, change: { kind: 'addProperty', property: { id: newId(), name: uniqueName(db.database), type: 'text' } } })
  void workspace
  return <div className="row-properties" aria-label="Properties">
    {shown.map(property => {
      const value = cellValue(db.database, row, property.id)
      const key = cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: property.id })
      return <div key={property.id} className="row-property">
        <span className="row-property-name">{property.name}</span>
        {property.type === 'checkbox'
          ? <span className="row-property-value"><PropertyCheckbox checked={value === true} label={property.name} onToggle={next => commit(db, row, property.id, next ? true : undefined)} /></span>
          : <button type="button" className="row-property-value" data-cell={key} onClick={() => setOpenCell({ blockId, databaseId: db.id, rowId: row.id, columnId: property.id })}>
              {isEmptyValue(value) ? <span className="is-placeholder">Empty</span> : <PropertyCell property={property} value={value} today={today} />}
            </button>}
      </div>
    })}
    {fold && <button type="button" className="row-property-more" onClick={() => setUnfolded(true)}>{empty.length} empty properties ›</button>}
    <button type="button" className="row-property-add" onClick={addProperty}>+ Add property</button>
  </div>
}
