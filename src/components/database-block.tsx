// Databases R1 (design §4, §6, §10, §13): the `database` block in a page. Only a database's home block draws its table;
// any other block pointing at a database (a paste, an old copy, one left behind by Move to…) is a page card to it until
// linked views ship in R2 (Roadbuster 220ae60e). Cells edit through Jazz's value editors (property-editors.tsx); each
// commit is one `set-values` with its per-cell check (model §5.2).
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type SyntheticEvent, type UIEvent } from 'react'
import { cellValue, databaseRows, isDatabase, isEmptyValue, readValue, type Condition, newRowValues, propertyOf, rawOf, sameRaw, titleId, viewColumns, viewRows, type CellValue, type Database, type Json, type Property, type View } from '../domain/database.ts'
import type { Page, Workspace } from '../domain/types'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
import { ChevronDownIcon } from './icons'
import { PropertyCell, PropertyCheckbox, PropertyEditor } from './property-editors'
import { useWorkspace } from './use-day'
import { DatabaseMenuButton, openDatabaseMenu } from './database-menu'

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

/** What a block's menu asks of the page editor holding it (page-editor.tsx provides them). */
export interface BlockActions {
  /** The page the editor is editing. */
  hostPageId: string
  turnIntoPage(blockId: string, pageId: string): void
  turnIntoInline(cardId: string, pageId: string): void
  remove(blockId: string): void
  select(blockId: string): void
}
/** The actions of each block on screen, by block id: the menu lives outside the editor (app shell) and finds them here. */
export const blockActions = new Map<string, BlockActions>()

export function DatabaseBlock({ blockId, pageId, hostDate, actions }: { blockId: string; pageId: string; hostDate: string | null; actions?: BlockActions | null }) {
  useLayoutEffect(() => { if (!actions) return; blockActions.set(blockId, actions); return () => { if (blockActions.get(blockId) === actions) blockActions.delete(blockId) } }, [blockId, actions])
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
/** Cell values on their way to the server, or whose save failed (offline): shown in the cell until saved or undone. */
interface PendingCell { databaseId: string; raw: Json | undefined; failed: boolean; retry: () => void; discard: () => void }
const pendingCells = new Map<string, PendingCell>()
const pendingCellListeners = new Set<() => void>()
let pendingCellVersion = 0
const pendingKey = (rowId: string, columnId: string) => `${rowId}|${columnId}`
function setPendingCell(key: string, cell: PendingCell | null) {
  if (cell) pendingCells.set(key, cell); else pendingCells.delete(key)
  pendingCellVersion++
  for (const l of pendingCellListeners) l()
}
function usePendingCells() {
  return useSyncExternalStore(l => { pendingCellListeners.add(l); return () => pendingCellListeners.delete(l) }, () => pendingCellVersion, () => 0)
}

/**
 * One cell's commit: sent with what the cell held, resent once after "Saved elsewhere" if that cell is unchanged, else
 * the changed-elsewhere notice. While it's on its way, and after a save that failed (offline), the cell shows his value
 * (design §13: "Never a silent revert") and the table says "1 change not saved · Retry · Undo".
 */
function useCommitCell() {
  const { run, refresh, latest } = useWorkspace()
  const commit = (db: Page & { database: Database }, row: Page, columnId: string, raw: Json | undefined, notice?: string, onSaved?: () => void) => {
    const expected = (rawOf(row, columnId) ?? null) as Json
    const values = { [columnId]: raw ?? null } as Record<string, Json>
    const property = propertyOf(db.database, columnId) ?? titleProperty
    const key = pendingKey(row.id, columnId)
    let resentOnce = false, refused = false
    const pending = (failed: boolean): PendingCell => ({
      databaseId: db.id, raw, failed,
      retry: () => { const now = latest()?.pages.find(p => p.id === row.id); setPendingCell(key, null); if (now && !now.trashedAt) commit(db, { ...now, ...(columnId === titleId ? { title: String(expected ?? '') } : { values: { ...now.values, [columnId]: expected } }) } as Page, columnId, raw, notice, onSaved) },
      discard: () => { setPendingCell(key, null); onSaved?.() },
    })
    const send = () => run(
      { type: 'set-values', pageId: row.id, values, expected: { [columnId]: expected }, at: new Date().toISOString() },
      notice ? r => ({ text: notice, undoOperationId: r.operationId }) : null, newId(),
      { inlineRefusal: /Saved elsewhere|Changed elsewhere/, onRefused: () => { refused = true; void again() }, quiet: true })
    const settle = (r: unknown) => {
      if (r) { setPendingCell(key, null); onSaved?.(); return }
      if (!refused) setPendingCell(key, pending(true))
    }
    const again = async () => {
      setPendingCell(key, null)
      const fresh = await refresh()
      const now = fresh.pages.find(p => p.id === row.id)
      // A row deleted meanwhile: his value goes quietly (Bumblebee 3c5198d5). A kept copy is done with once its value
      // is saved, its row is gone, or he's been asked (the notice below); a save that only failed keeps it.
      if (!now || now.trashedAt) { onSaved?.(); return }
      if (sameRaw(rawOf(now, columnId), expected) && !resentOnce) { resentOnce = true; refused = false; setPendingCell(key, pending(false)); void send().then(settle); return }
      onSaved?.()
      // One wording everywhere (Lead 0b05067c, design §13).
      const mine = typeof raw === 'string' ? `“${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}”` : raw === undefined ? 'empty' : String(raw)
      const toastKey: string = toast(`${property.name} in ${displayPageTitle(now)} changed elsewhere · yours was ${mine}`, {
        timeout: 10_000, actionProps: { children: 'Use mine', onPress: () => { toast.close(toastKey); commit(db, now, columnId, raw) } },
      })
    }
    setPendingCell(key, pending(false))
    void send().then(settle)
  }
  return commit
}


// ---------------------------------------------------------------- kept drafts of text cells (R1-15)
// An open Text or URL editor keeps what he types on this device, one entry per cell, so a phone app killed before its
// hide event still has it: the next start sends it if the cell still holds what he started from, and otherwise says it
// changed elsewhere (Lead 0b05067c's wording). A save that lands clears it; a row deleted meanwhile drops it quietly.

interface CellDraft { databaseId: string; rowId: string; columnId: string; value: string; expected: Json; tab: string; seen: number }
const draftPrefix = 'daythread:cell-draft:'
const draftKey = (rowId: string, columnId: string) => `${draftPrefix}${rowId}:${columnId}`
/** This tab, to tell its own open editor's draft from another live tab's. */
const thisTab = crypto.randomUUID()
function keepDraft(d: Omit<CellDraft, 'tab' | 'seen'>) {
  try { localStorage.setItem(draftKey(d.rowId, d.columnId), JSON.stringify({ ...d, tab: thisTab, seen: Date.now() })) } catch { /* storage full or off: the hide save still runs */ }
}
function dropDraft(rowId: string, columnId: string, value?: string) {
  try {
    const key = draftKey(rowId, columnId)
    // Only the draft it was saving: he may have opened the cell again and typed more since.
    if (value !== undefined) { const kept = JSON.parse(localStorage.getItem(key) ?? 'null') as CellDraft | null; if (kept && kept.value !== value) return }
    localStorage.removeItem(key)
  } catch { /* nothing kept */ }
}
function keptDrafts(): CellDraft[] {
  const out: CellDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(draftPrefix)) continue
      try { out.push(JSON.parse(localStorage.getItem(key)!) as CellDraft) } catch { localStorage.removeItem(key) }
    }
  } catch { /* storage off */ }
  return out
}
/** Another tab's draft that changed this recently may still be open there; it waits for the next look. */
const liveDraftMs = 5000

/** Sends the drafts a closed or killed tab left, once the workspace is here, and again a little later. */
function useRecoverDrafts(commit: ReturnType<typeof useCommitCell>) {
  const { workspace, latest } = useWorkspace()
  const loaded = Boolean(workspace)
  useEffect(() => {
    if (!loaded) return
    const recover = () => {
      const ws = latest()
      if (!ws) return
      for (const d of keptDrafts()) {
        if (d.tab === thisTab && openCell?.rowId === d.rowId && openCell.columnId === d.columnId) continue
        if (d.tab !== thisTab && Date.now() - d.seen < liveDraftMs) continue
        const db = ws.pages.find(p => p.id === d.databaseId), row = ws.pages.find(p => p.id === d.rowId)
        if (!isDatabase(db) || !row || row.trashedAt || db.trashedAt || (d.columnId !== titleId && !propertyOf(db.database, d.columnId))) { dropDraft(d.rowId, d.columnId); continue }
        const raw = d.value === '' ? undefined : d.value
        if (sameRaw(rawOf(row, d.columnId), raw ?? (d.columnId === titleId ? '' : null))) { dropDraft(d.rowId, d.columnId); continue }
        // Sent against what he started from: the resend-once and the "changed elsewhere" notice are the commit's own.
        const started = { ...row, ...(d.columnId === titleId ? { title: String(d.expected ?? '') } : { values: { ...row.values, [d.columnId]: d.expected } }) } as Page
        commit(db, started, d.columnId, d.columnId === titleId ? (raw ?? '') : raw, undefined, () => dropDraft(d.rowId, d.columnId))
      }
    }
    recover()
    const later = setTimeout(recover, liveDraftMs + 1000)
    return () => clearTimeout(later)
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Mounted once (app shell): the editor of the open cell, under its cell, or as a sheet on the phone. */
export function DatabaseCellEditor() {
  const { workspace, run } = useWorkspace()
  const cell = useOpenCell()
  const commit = useCommitCell()
  useRecoverDrafts(commit)
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
  const expected = (rawOf(row, cell.columnId) ?? (cell.columnId === titleId ? '' : null)) as Json
  const keeps = property.type === 'text' || property.type === 'url'

  const value = cell.columnId === titleId ? (row.title || null) : cellValue(db.database, row, cell.columnId)
  return <PropertyEditor key={cellKey(cell)}
    property={property} value={value as CellValue} rowTitle={displayPageTitle(row)} anchor={anchor}
    onDraft={keeps ? text => keepDraft({ databaseId: db.id, rowId: row.id, columnId: cell.columnId, value: text, expected }) : undefined}
    onCommit={(raw, info) => {
      setOpenCell(null)
      const sent = typeof raw === 'string' ? raw : ''
      commit(db, row, cell.columnId, cell.columnId === titleId ? (raw ?? '') : raw, info?.notice, keeps ? () => dropDraft(row.id, cell.columnId, sent) : undefined)
    }}
    onCancel={() => { setOpenCell(null); if (keeps) dropDraft(row.id, cell.columnId) }}
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
  const { run, latest } = useWorkspace()
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
  usePendingCells()
  const failedHere = [...pendingCells.values()].filter(p => p.failed && p.databaseId === db.id)
  /**
   * Keys in the table at 1280 (design §10): arrows move the cell cursor, Tab/Shift-Tab along a row, Enter opens the
   * cell (a button's own Enter), Delete clears it, Esc gives the block back to the page selected whole, and ⌘Z undoes
   * the last change where the workspace's one Undo slot still holds it.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && target.tagName !== 'INPUT') {
      e.preventDefault()
      const undo = latest()?.undo
      if (undo) void run({ type: 'undo', targetOperationId: undo.operationId }, { text: 'Undone' }, undefined, { inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => toast("Can't undo · edited since", { timeout: 6000 }) })
      else toast("Can't undo · edited since", { timeout: 6000 })
      return
    }
    const nav = target.closest<HTMLElement>('[data-nav]')?.dataset.nav
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    if (!nav || target.tagName === 'INPUT') return
    const [r, c] = nav.split(':').map(Number) as [number, number]
    const width = columns.length + 1
    const move = (row: number, col: number) => {
      const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-nav="${row}:${col}"]`)
      if (el) { e.preventDefault(); el.focus() }
    }
    if (e.key === 'ArrowDown') move(r + 1, c)
    else if (e.key === 'ArrowUp') move(r - 1, c)
    else if (e.key === 'ArrowRight') move(r, c + 1)
    else if (e.key === 'ArrowLeft') move(r, c - 1)
    else if (e.key === 'Tab') { e.preventDefault(); const i = r * width + c + (e.shiftKey ? -1 : 1); move(Math.floor(i / width), ((i % width) + width) % width) }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && c > 0) {
      const row = shown[r], property = columns[c - 1]?.property
      if (row && property && !isEmptyValue(cellValue(db.database, row, property.id))) { e.preventDefault(); commit(db, row, property.id, undefined) }
    }
  }
  return <div className="database-table-wrap" onKeyDown={onKeyDown}>
    {!showTitle && <div className="database-title-row is-page"><span className="database-view-name">{view.name}<ChevronDownIcon /></span><DatabaseMenuButton blockId={blockId} databaseId={db.id} /></div>}
    {showTitle && <div className="database-title-row">
      <input className="database-title" data-database={db.id} aria-label="Database name" placeholder="Untitled database" defaultValue={db.title} key={db.title}
        onBlur={e => rename(e.currentTarget.value.trim())}
        // Enter in a new database's title goes on to its first row's Name (design §3.1).
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.currentTarget.blur(); if (!databaseRows(workspace, db.id).length) addRow() } }} />
      <span className="database-view-name">{view.name}<ChevronDownIcon /></span>
      <DatabaseMenuButton blockId={blockId} databaseId={db.id} />
    </div>}
    {(view.filter.length > 0 || view.sort.length > 0) && <RulesLine db={db.database} view={view} blockId={blockId} databaseId={db.id} onChange={change => void run({ type: 'change-database', pageId: db.id, change: { kind: 'updateView', viewId: view.id, ...change } })} />}
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
              <button type="button" className="database-title-cell" data-cell={key(row.id, titleId)} data-nav={`${shown.indexOf(row)}:0`} onClick={() => void navigate({ to: '/pages', search: { page: row.id } })}>
                <span className={row.title ? '' : 'is-placeholder'}>{row.title || 'Untitled'}</span>
              </button>
              <button type="button" className="database-open" onClick={() => void navigate({ to: '/pages', search: { page: row.id } })}>Open</button>
            </div></td>
            {columns.map(({ property }, col) => {
              const pending = pendingCells.get(pendingKey(row.id, property.id))
              // His value stays shown while it saves and after a failed save, never a silent revert (design §13).
              const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
              const navId = `${shown.indexOf(row)}:${col + 1}`
              return <td key={property.id} className={`database-td is-${property.type}${pending?.failed ? ' is-unsaved' : pending ? ' is-saving' : ''}`}>
                {property.type === 'checkbox'
                  ? <span data-nav={navId} tabIndex={0} className="database-check-cell" onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); commit(db, row, property.id, value === true ? undefined : true) } }}>
                      <PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />
                    </span>
                  : <button type="button" className="database-cell" data-cell={key(row.id, property.id)} data-nav={navId} onClick={() => open(row.id, property.id)}>
                      <PropertyCell property={property} value={value} today={today} />
                    </button>}
              </td>
            })}
            <td className="database-td is-add" />
          </tr>)}
        </tbody>
      </table>
    </div>
    {rows.length === 0 && view.filter.length > 0 && <p className="database-empty">No rows match this view · <button type="button" className="app-link" onClick={() => void run({ type: 'change-database', pageId: db.id, change: { kind: 'updateView', viewId: view.id, filter: [] } })}>Clear filter</button></p>}
    {failedHere.length > 0 && <p className="database-unsaved" role="status">{failedHere.length === 1 ? '1 change' : `${failedHere.length} changes`} not saved · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.retry())}>Retry</button> · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.discard())}>Undo</button></p>}
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
  usePendingCells()
  const failedHere = [...pendingCells.values()].filter(p => p.failed && p.databaseId === db.id)
  const shown = fold ? properties.filter(p => !empty.includes(p)) : properties
  const addProperty = () => void run({ type: 'change-database', pageId: db.id, change: { kind: 'addProperty', property: { id: newId(), name: uniqueName(db.database), type: 'text' } } })
  void workspace
  return <div className="row-properties" aria-label="Properties">
    {shown.map(property => {
      const pending = pendingCells.get(pendingKey(row.id, property.id))
      const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
      const key = cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: property.id })
      return <div key={property.id} className={`row-property${pending?.failed ? ' is-unsaved' : ''}`}>
        <span className="row-property-name" data-type={property.type}>{property.name}</span>
        {property.type === 'checkbox'
          ? <span className="row-property-value"><PropertyCheckbox checked={value === true} label={property.name} onToggle={next => commit(db, row, property.id, next ? true : undefined)} /></span>
          : <button type="button" className="row-property-value" data-cell={key} onClick={() => setOpenCell({ blockId, databaseId: db.id, rowId: row.id, columnId: property.id })}>
              {isEmptyValue(value) ? <span className="is-placeholder">Empty</span> : <PropertyCell property={property} value={value} today={today} />}
            </button>}
      </div>
    })}
    {fold && <button type="button" className="row-property-more" onClick={() => setUnfolded(true)}>{empty.length} empty properties ›</button>}
    {failedHere.length > 0 && <p className="database-unsaved" role="status">{failedHere.length === 1 ? '1 change' : `${failedHere.length} changes`} not saved · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.retry())}>Retry</button> · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.discard())}>Undo</button></p>}
    <button type="button" className="row-property-add" onClick={addProperty}>+ Add property</button>
  </div>
}

/**
 * The line under the title (design §4.1, §13) whenever the view filters or sorts: each rule in words, opening its sheet
 * when tapped, each with its own ×; a rule on a deleted property struck through; one with no value yet reads "…".
 */
function RulesLine({ db, view, blockId, databaseId, onChange }: { db: Database; view: View; blockId: string; databaseId: string; onChange: (change: { filter?: Condition[]; sort?: View['sort'] }) => void }) {
  return <div className="database-filter-line">
    {view.filter.map((c, i) => {
      const property = propertyOf(db, c.by)
      return <span key={`f${i}`} className={`database-filter-chip ${property ? '' : 'is-deleted'}`}>
        <button type="button" className="database-chip-open" onClick={() => openDatabaseMenu(blockId, databaseId, 'filter')}>{property ? property.name : '(deleted)'} {filterWords(c, property)}</button>
        <button type="button" className="database-chip-remove" aria-label="Remove filter" onClick={() => onChange({ filter: view.filter.filter((_, j) => j !== i) })}>×</button>
      </span>
    })}
    {view.sort.map((s, i) => {
      const property = propertyOf(db, s.by)
      if (!property) return null
      return <span key={`s${i}`} className="database-filter-chip is-sort">
        <button type="button" className="database-chip-open" onClick={() => openDatabaseMenu(blockId, databaseId, 'sort')}>{property.name} {s.direction === 'asc' ? '↑' : '↓'}</button>
        <button type="button" className="database-chip-remove" aria-label="Remove sort" onClick={() => onChange({ sort: view.sort.filter((_, j) => j !== i) })}>×</button>
      </span>
    })}
  </div>
}
function filterWords(c: Condition, property: Property | null): string {
  const op = { contains: 'contains', doesNotContain: "doesn't contain", is: 'is', isNot: 'is not', isEmpty: 'is empty', isNotEmpty: 'is not empty', eq: '=', ne: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', isAnyOf: 'is', isNoneOf: 'is not', before: 'before', after: 'after', onOrBefore: 'on or before', onOrAfter: 'on or after', within: 'within' }[c.op]
  if (c.op === 'isEmpty' || c.op === 'isNotEmpty') return op
  const v = c.value
  const name = (id: unknown) => property?.options?.find(o => o.id === id)?.name ?? ''
  const text = v === undefined ? '' : Array.isArray(v) ? v.map(name).filter(Boolean).join(' or ')
    : v && typeof v === 'object' ? ('relative' in v ? (v.relative === 'today' ? 'today' : "this page's day") : String((v as { date?: string }).date ?? ''))
    : v === true ? 'checked' : v === false ? 'unchecked'
    : c.op === 'within' ? ({ thisWeek: 'this week', past7: 'the past 7 days', next7: 'the next 7 days' } as Record<string, string>)[String(v)] ?? ''
    : String(v)
  // A rule still waiting for its value reads as unfinished, not broken (Jazz 72ba456b).
  return `${op} ${text || '…'}`
}
