// Databases R1 (design §4, §6, §10, §13): the `database` block in a page. Only a database's home block draws its table;
// any other block pointing at a database (a paste, an old copy, one left behind by Move to…) is a page card to it until
// linked views ship in R2 (Roadbuster 220ae60e). Cells edit through Jazz's value editors (property-editors.tsx); each
// commit is one `set-values` with its per-cell check (model §5.2).
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { cellValue, databaseRows, isDatabase, newRowValues, propertyOf, rawOf, sameRaw, titleId, viewColumns, viewRows, type CellValue, type Database, type Json, type Property, type View } from '../domain/database.ts'
import type { Page, Workspace } from '../domain/types'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
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

export function DatabaseBlock({ blockId, pageId, hostDate }: { blockId: string; pageId: string; hostDate: string | null }) {
  const { workspace } = useWorkspace()
  const db = workspace?.pages.find(p => p.id === pageId)
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
export function DatabaseTable({ workspace, db, blockId, pageDate, cap }: { workspace: Workspace; db: Page & { database: Database }; blockId: string; pageDate: string | null; cap: number }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  const commit = useCommitCell()
  const today = todayIso()
  const view = shownView(db.database, blockId)
  const context = useMemo(() => ({ today, pageDate }), [today, pageDate])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const columns = viewColumns(db.database, view)
  const [limit, setLimit] = useState(cap)
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
    <div className="database-title-row">
      <input className="database-title" aria-label="Database name" placeholder="Untitled database" defaultValue={db.title} key={db.title}
        onBlur={e => rename(e.currentTarget.value.trim())} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }} />
      <span className="database-view-name">{view.name}</span>
    </div>
    <div className="database-scroll">
      <table className="database-table">
        <thead>
          <tr>
            <th scope="col" className="database-th is-title" style={{ width: titleWidth }}>Name</th>
            {columns.map(c => <th key={c.property.id} scope="col" className="database-th" style={{ width: c.width ?? defaultWidth(c.property) }}>{c.property.name}</th>)}
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
    {rows.length > limit && <button type="button" className="database-more" onClick={() => setLimit(l => l + 25)}>Show 25 more</button>}
    <button type="button" className="database-new" onClick={addRow}>+ New</button>
  </div>
}

/** Column widths until he drags one (stored on the view): the title wider, a box or a number narrower. */
const titleWidth = 220
function defaultWidth(property: Property): number {
  return property.type === 'checkbox' ? 90 : property.type === 'number' ? 110 : 160
}
/** "Property", "Property 2", …: never a name the database already has (or "Name"). */
function uniqueName(db: Database): string {
  const taken = new Set(['name', ...db.properties.map(p => p.name.toLocaleLowerCase())])
  for (let n = 1; ; n++) { const name = n === 1 ? 'Property' : `Property ${n}`; if (!taken.has(name.toLocaleLowerCase())) return name }
}
