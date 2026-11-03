// Databases R1 (design §4, §6, §10, §13): the `database` block in a page. Only a database's home block draws its table;
// any other block pointing at a database (a paste, an old copy, one left behind by Move to…) is a page card to it until
// linked views ship in R2 (Roadbuster 220ae60e). Cells edit through Jazz's value editors (property-editors.tsx); each
// commit is one `set-values` with its per-cell check (model §5.2).
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent, type UIEvent } from 'react'
import { sectionKey, splitSection, viewSection, viewSections, viewSubGroupBy, viewSubGroups, canWrap, cellValue, columnCalc, databaseRows, groupValue, isDatabase, inView, isEmptyValue, isReadOnly, newRowProbe, noGroupKey, readValue, type Condition, newRowValues, templateValues, propertyOf, rawOf, sameRaw, titleId, valueText, viewColumns, viewGroups, viewCalculations, viewRows, type ViewContext, type ViewGroup, type ViewGroups, type CellValue, type Database, type DatabaseChange, type Json, type Property, type View } from '../domain/database.ts'
import type { Page, WeekStart, Workspace } from '../domain/types'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
import { ChevronDownIcon, ChevronRightIcon } from './icons'
import { holdKeyboard } from './keyboard'
import { PropertyCell, PropertyCheckbox, PropertyEditor, useSaveOnHide, useWide } from './property-editors'
import { calcText, emailHref, phoneHref, urlHref } from './property-values'
import { defaultRowTemplate } from '../domain/day-template'
import { useTaskTick, useWorkspace } from './use-day'
import { announceSave } from './draft-slots'
import { taskRows } from '../domain/workspace'
import { newTodo, newTodoRowId, taskIdOfRow, todoChange, todoLine, todoMoves, todoRowId, todosSourceId, readingWorkspace, withTodos } from '../domain/todos-source'
import { DatabaseBoard } from './database-board'
import { DatabaseCalendar } from './database-calendar'
import { DatabaseGallery } from './database-gallery'
import { LinkedDatabase } from './database-linked'
import { DatabaseList } from './database-list'
import { DatabaseMenuButton, DatabaseViewsButton, openDatabaseMenu } from './database-menu'

const newId = (): string => crypto.randomUUID()
/** Rows drawn before "Show 25 more" (design §13): inline, and on the full page. */
export const rowCaps = { inline: 25, page: 100 } as const
const titleProperty: Property = { id: titleId, name: 'Name', type: 'text' }
const returnKey = "daythread.database-return"

/** Keys, input and pointer presses inside the block never reach the page editor (design §10). */
const isolate = { onKeyDown: stop, onKeyUp: stop, onKeyPress: stop, onBeforeInput: stop, onInput: stop, onPaste: stop, onCut: stop, onCopy: stop, onCompositionStart: stop, onCompositionUpdate: stop, onCompositionEnd: stop, onMouseDown: noTouchFocus, onPointerDown: rememberPointer, onDrop: stop, onDragOver: stop }
function stop(e: SyntheticEvent) { e.stopPropagation() }
/**
 * On a phone, a tap on a cell or a button in the block focused the page editor around it: a caret at the page's
 * start, and the keyboard coming up under the `⋯` sheet (Jazz's native run on 24fbd0c9). A touch's mousedown keeps
 * focus where it is, except on a field of the block's own (the title). A mouse still focuses, for the cell cursor.
 */
let lastPointer = 'mouse'
function rememberPointer(e: React.PointerEvent) { e.stopPropagation(); lastPointer = e.pointerType }
function noTouchFocus(e: React.MouseEvent) {
  e.stopPropagation()
  if (lastPointer !== 'mouse' && !(e.target as Element).closest('input, textarea, select')) e.preventDefault()
}

/** The view a block shows on this device: a local preference per block, never a save (Lead 7b3b9664). */
function viewKey(blockId: string) { return `daythread.database-view.${blockId}` }
const viewListeners = new Set<() => void>()
let viewVersion = 0
/** Picks the view a block shows on this device: a local preference, never a save or an Undo (Lead 7b3b9664). */
export function setShownView(blockId: string, viewId: string) {
  try { localStorage.setItem(viewKey(blockId), viewId) } catch { /* private mode: this tab only */ }
  viewVersion++
  for (const l of viewListeners) l()
}
export function useShownViews() { return useSyncExternalStore(l => { viewListeners.add(l); return () => viewListeners.delete(l) }, () => viewVersion, () => 0) }
/** The linked views on screen, by block: the menu lives outside the editor and finds a block's view and its change here. */
interface LinkedBlock { view: View; json: string; change: ChangeView }
const linkedBlocks = new Map<string, LinkedBlock>()
export function setLinkedBlock(blockId: string, entry: LinkedBlock | null) {
  const changed = linkedBlocks.get(blockId)?.json !== entry?.json
  if (entry) linkedBlocks.set(blockId, entry); else linkedBlocks.delete(blockId)
  if (!changed || !entry) return
  viewVersion++
  for (const l of viewListeners) l()
}
export const isLinkedBlock = (blockId: string) => linkedBlocks.has(blockId)
export function shownView(db: Database, blockId: string): View {
  const linked = linkedBlocks.get(blockId)
  if (linked) return linked.view
  let id: string | null = null
  try { id = localStorage.getItem(viewKey(blockId)) } catch { /* private mode */ }
  return db.views.find(v => v.id === id) ?? db.views[0]!
}
export type ViewFields = Omit<Extract<DatabaseChange, { kind: 'updateView' }>, 'kind' | 'viewId'>
/** A change to a view's own settings: everything that edits one goes through here, built from its latest copy. */
export type ChangeView = (build: (current: View) => ViewFields) => void
/** Which block the menu is open on: a linked view's changes go to its block, not its database. */
export const MenuBlock = createContext<string | null>(null)
export function useViewChange(databaseId: string, viewId: string): ChangeView {
  const { run } = useWorkspace()
  const blockId = useContext(MenuBlock)
  const linked = blockId ? linkedBlocks.get(blockId) : undefined
  if (linked) return linked.change
  return build => void run(ws => {
    const now = ws.pages.find(p => p.id === databaseId), current = isDatabase(now) ? now.database.views.find(v => v.id === viewId) : undefined
    return current ? { type: 'change-database', pageId: databaseId, change: { kind: 'updateView', viewId, ...build(current) } } : null
  })
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
  /** A linked view's settings live in its block: this changes them, from what the block holds now. */
  updateLinkedView(blockId: string, build: (json: string) => string): void
  /** Another block of the same database, right after this one: a linked view (design §9.1). */
  duplicate(blockId: string): void
}
/** The actions of each block on screen, by block id: the menu lives outside the editor (app shell) and finds them here. */
export const blockActions = new Map<string, BlockActions>()

export function DatabaseBlock({ blockId, pageId, viewJson, hostDate, actions }: { blockId: string; pageId: string; viewJson: string; hostDate: string | null; actions?: BlockActions | null }) {
  useLayoutEffect(() => { if (!actions) return; blockActions.set(blockId, actions); return () => { if (blockActions.get(blockId) === actions) blockActions.delete(blockId) } }, [blockId, actions])
  const { workspace: stored } = useWorkspace()
  usePendingDatabases()
  const workspace = stored && readingWorkspace(stored, pageId)
  const db = workspace?.pages.find(p => p.id === pageId)
  const pending = db ? undefined : pendingDatabases.get(pageId)
  if (pending) return <div className="database-block is-pending" contentEditable={false} {...isolate}>
    <div className="database-title-row"><span className="database-title is-placeholder">Untitled database</span></div>
    {pending.state === 'creating' ? <p className="database-empty">Creating…</p>
      : <button type="button" className="database-new" onClick={pending.retry}>Not created · Retry</button>}
  </div>
  if (!workspace || !isDatabase(db)) return <DatabaseCard pageId={pageId} />
  if (db.database.homeBlockId !== blockId) return <div className="database-block" contentEditable={false} {...isolate}>
    <LinkedDatabase workspace={workspace} db={db} blockId={blockId} json={viewJson} pageDate={hostDate} actions={actions} />
  </div>
  if (db.trashedAt) return <DatabaseCard pageId={pageId} />
  return <div className="database-block" contentEditable={false} {...isolate}>
    <DatabaseView workspace={workspace} db={db} blockId={blockId} pageDate={hostDate} cap={rowCaps.inline} />
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

/** `group`: a Multi-select's row is shown in each of its groups, with a cell in each; the editor opens under the one tapped. */
export interface OpenCell { blockId: string; databaseId: string; rowId: string; columnId: string; group?: string }
let openCell: OpenCell | null = null
const cellListeners = new Set<() => void>()
export function setOpenCell(next: OpenCell | null) { openCell = next; for (const l of cellListeners) l() }
function useOpenCell(): OpenCell | null {
  return useSyncExternalStore(l => { cellListeners.add(l); return () => cellListeners.delete(l) }, () => openCell, () => null)
}
export const cellKey = (c: OpenCell) => `${c.blockId}|${c.rowId}|${c.columnId}|${c.group ?? ''}`
/** Operations already resent once after "Saved elsewhere" (model §5.2: once, never in a loop). */
const resent = new Set<string>()

/** What a block's table keeps across BlockNote's redraws (by block id, for this tab): where it was scrolled, rows shown. */
export const blockPlaces = new Map<string, { scrollLeft: number; limit: number; groups?: Record<string, number> }>()

/** One cell's commit: sent with what the cell held, resent once after "Saved elsewhere" if that cell is unchanged. */
/** Cell values on their way to the server, or whose save failed (offline): shown in the cell until saved or undone. */
/** `beforeId`: the place a dropped card is going to, so it shows there until it's saved. */
interface PendingCell { databaseId: string; rowId: string; columnId: string; raw: Json | undefined; failed: boolean; retry: () => void; discard: () => void; beforeId?: string | null; /** The rest of one change, whose first cell speaks for it. */ part?: true }
export const pendingCells = new Map<string, PendingCell>()
const pendingCellListeners = new Set<() => void>()
let pendingCellVersion = 0
export const pendingKey = (rowId: string, columnId: string) => `${rowId}|${columnId}`
function setPendingCell(key: string, cell: PendingCell | null) {
  if (cell) pendingCells.set(key, cell); else pendingCells.delete(key)
  pendingCellVersion++
  for (const l of pendingCellListeners) l()
}
export function usePendingCells() {
  return useSyncExternalStore(l => { pendingCellListeners.add(l); return () => pendingCellListeners.delete(l) }, () => pendingCellVersion, () => 0)
}

/**
 * One cell's commit: sent with what the cell held, resent once after "Saved elsewhere" if that cell is unchanged, else
 * the changed-elsewhere notice. While it's on its way, and after a save that failed (offline), the cell shows his value
 * (design §13: "Never a silent revert") and the table says "1 change not saved · Retry · Undo".
 */
export function useCommitCell() {
  const { run, refresh, latest } = useWorkspace()
  /** `also`: more cells of this row in the same save, so one Undo takes them all: a drag across both layers of a view. */
  const commit = (db: Page & { database: Database }, row: Page, columnId: string, raw: Json | undefined, notice?: string, onSaved?: () => void, beforeId?: string | null, also: { columnId: string; raw: Json | undefined }[] = []) => {
    const key = pendingKey(row.id, columnId)
    const taskId = taskIdOfRow(row.id)
    // A to-do: the task's own command and notice, with no check of its own (those commands have none), never a row's set-values.
    if (taskId) {
      const ws = latest()
      const change = ws ? todoChange(ws, taskId, columnId, raw, todayIso()) : null
      if (!change) { onSaved?.(); return }
      if ('refused' in change) { toast(change.refused, { timeout: 6000 }); return }
      const pendingTodo = (failed: boolean): PendingCell => ({ databaseId: db.id, rowId: row.id, columnId, raw, failed, retry: () => { setPendingCell(key, null); commit(db, row, columnId, raw, notice, onSaved) }, discard: () => { setPendingCell(key, null); onSaved?.() } })
      setPendingCell(key, pendingTodo(false))
      void run(change.action, r => ({ text: notice ?? change.notice, undoOperationId: r.operationId }), newId(), { quiet: true }).then(r => {
        setPendingCell(key, r ? null : pendingTodo(true))
        if (!r) return
        // New words change lines on their pages: a tab open on one should read that as this browser, not another device.
        if (change.action.type === 'rename-task') for (const { page } of taskRows(latest() ?? ws!, taskId)) announceSave(page.id)
        onSaved?.()
      })
      return
    }
    // A value still on its way is what this change will find when it lands, so it's built on that (Lead's review, 7).
    const inFlight = pendingCells.get(key)
    const expected = ((inFlight && !inFlight.failed ? inFlight.raw : rawOf(row, columnId)) ?? null) as Json
    const expectedOf = (id: string): Json => { const flying = pendingCells.get(pendingKey(row.id, id)); return ((flying && !flying.failed ? flying.raw : rawOf(row, id)) ?? null) as Json }
    const alsoExpected = also.map(c => ({ ...c, expected: expectedOf(c.columnId) }))
    const values = { [columnId]: raw ?? null, ...Object.fromEntries(also.map(c => [c.columnId, c.raw ?? null])) } as Record<string, Json>
    const property = propertyOf(db.database, columnId) ?? titleProperty
    let resentOnce = false, refused = false
    // Only the newest commit of a cell speaks for it: an older one landing must not clear what a newer one is showing.
    let mine: PendingCell | null = null
    // The first cell holds the row's place; a part leaves alone a newer value of its own cell.
    const parts = new Map<string, PendingCell>()
    const showAlso = (next: PendingCell | null) => {
      for (const c of also) {
        const partKey = pendingKey(row.id, c.columnId), held = parts.get(partKey)
        if (held && pendingCells.get(partKey) !== held) continue
        const part = next ? (() => { const { beforeId: _place, ...rest } = next; return { ...rest, columnId: c.columnId, raw: c.raw, part: true as const } })() : null
        if (part) parts.set(partKey, part)
        setPendingCell(partKey, part)
      }
    }
    const show = (next: PendingCell | null) => { if (mine && pendingCells.get(key) !== mine) return; mine = next; setPendingCell(key, next); showAlso(next) }
    const pending = (failed: boolean): PendingCell => ({
      databaseId: db.id, rowId: row.id, columnId, raw, failed, ...(beforeId !== undefined ? { beforeId } : {}),
      retry: () => { const now = latest()?.pages.find(p => p.id === row.id); show(null); if (now && !now.trashedAt) commit(db, { ...now, ...(columnId === titleId ? { title: String(expected ?? '') } : { values: { ...now.values, [columnId]: expected, ...Object.fromEntries(alsoExpected.map(c => [c.columnId, c.expected])) } }) } as Page, columnId, raw, notice, onSaved, beforeId, also) },
      discard: () => { show(null); onSaved?.() },
    })
    const named = (Array.isArray(raw) ? raw : []).flatMap(id => namedTodos.get(String(id)) ?? [])
    const newTodos = named.map(todo => ({ ...todo, on: todayIso() }))
    const said = notice ?? (named.length ? (named.length === 1 ? 'To-do added' : `${named.length} to-dos added`) : undefined)
    const send = () => run(
      { type: 'set-values', pageId: row.id, values, expected: { [columnId]: expected, ...Object.fromEntries(alsoExpected.map(c => [c.columnId, c.expected])) }, ...(beforeId !== undefined ? { beforeId } : {}), ...(newTodos.length ? { newTodos } : {}), at: new Date().toISOString() },
      said ? r => ({ text: said, undoOperationId: r.operationId }) : null, newId(),
      { inlineRefusal: /Saved elsewhere|Changed elsewhere/, onRefused: () => { refused = true; void again() }, quiet: true })
    const settle = (r: unknown) => {
      if (r) { show(null); onSaved?.(); return }
      if (!refused) show(pending(true))
    }
    const again = async () => {
      show(null)
      const fresh = await refresh()
      const now = fresh.pages.find(p => p.id === row.id)
      // A row deleted meanwhile: his value goes quietly (Bumblebee 3c5198d5). A kept copy is done with once its value
      // is saved, its row is gone, or he's been asked (the notice below); a save that only failed keeps it.
      if (!now || now.trashedAt) { onSaved?.(); return }
      if (sameRaw(rawOf(now, columnId), expected) && alsoExpected.every(c => sameRaw(rawOf(now, c.columnId), c.expected)) && !resentOnce) { resentOnce = true; refused = false; show(pending(false)); void send().then(settle); return }
      onSaved?.()
      // One wording everywhere (Lead 0b05067c, design §13).
      const mine = typeof raw === 'string' ? `“${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}”` : raw === undefined ? 'empty' : String(raw)
      const toastKey: string = toast(`${property.name} in ${displayPageTitle(now)} changed elsewhere · yours was ${mine}`, {
        timeout: 10_000, actionProps: { children: 'Use mine', onPress: () => { toast.close(toastKey); commit(db, now, columnId, raw, undefined, undefined, undefined, also) } },
      })
    }
    mine = pending(false)
    setPendingCell(key, mine)
    showAlso(mine)
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
let thisTabId: string | null = null
// On first use: Cloudflare Workers refuse random values in global scope, and this module loads on the server too.
const thisTab = () => (thisTabId ??= crypto.randomUUID())
function keepDraft(d: Omit<CellDraft, 'tab' | 'seen'>) {
  try { localStorage.setItem(draftKey(d.rowId, d.columnId), JSON.stringify({ ...d, tab: thisTab(), seen: Date.now() })) } catch { /* storage full or off: the hide save still runs */ }
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
        if (d.tab === thisTab() && openCell?.rowId === d.rowId && openCell.columnId === d.columnId) continue
        if (d.tab !== thisTab() && Date.now() - d.seen < liveDraftMs) continue
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
  const { workspace: stored, run } = useWorkspace()
  const cell = useOpenCell()
  const commit = useCommitCell()
  const addTodo = useAddTodo()
  useRecoverDrafts(commit)
  const workspace = stored && readingWorkspace(stored, cell?.databaseId)
  const db = cell ? workspace?.pages.find(p => p.id === cell.databaseId) : undefined
  const isNewTodo = cell?.rowId === newTodoRowId
  const row = isNewTodo ? ({ id: newTodoRowId, type: 'document', date: null, title: '', document: '[]' } as Page) : cell ? workspace?.pages.find(p => p.id === cell.rowId) : undefined
  const property = cell && isDatabase(db) ? (cell.columnId === titleId ? titleProperty : propertyOf(db.database, cell.columnId)) : null
  // The cell itself, found again whenever the block is drawn again, so the popover stays under it.
  const find = () => !cell ? null : isNewTodo
    ? document.querySelector<HTMLElement>(`[data-id="${CSS.escape(cell.blockId)}"] .database-new`) ?? document.querySelector<HTMLElement>(`[data-id="${CSS.escape(cell.blockId)}"]`)
    : document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellKey(cell))}"]`)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // Forgotten when it closes: a cell drawn again since would leave the next editor placed against nothing, at the screen's corner.
    if (!cell) { setAnchor(null); return }
    let frame = 0
    const check = () => { const el = find(); setAnchor(a => (a === el ? a : el)); frame = requestAnimationFrame(check) }
    check()
    return () => cancelAnimationFrame(frame)
  }, [cell]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!cell || !isDatabase(db) || !row || row.trashedAt || !property || property.readOnly || !anchor) return null
  // A value still on its way is the cell's value: the editor opens on it, not on the copy from before it.
  const inFlight = pendingCells.get(pendingKey(row.id, cell.columnId))
  const expected = ((inFlight ? inFlight.raw : rawOf(row, cell.columnId)) ?? (cell.columnId === titleId ? '' : null)) as Json
  const keeps = !db.database.fixed && (property.type === 'text' || property.type === 'url' || property.type === 'email' || property.type === 'phone')

  const value = cell.columnId === titleId ? ((inFlight ? String(inFlight.raw ?? '') : row.title) || null) : inFlight ? readValue(property, inFlight.raw) : cellValue(db.database, row, cell.columnId)
  return <PropertyEditor key={cellKey(cell)}
    property={property} value={value as CellValue} rowTitle={displayPageTitle(row)} anchor={anchor}
    onDraft={keeps ? text => keepDraft({ databaseId: db.id, rowId: row.id, columnId: cell.columnId, value: text, expected }) : undefined}
    onCommit={(raw, info) => {
      setOpenCell(null)
      if (isNewTodo) { addTodo(typeof raw === 'string' ? raw : ''); return }
      const sent = typeof raw === 'string' ? raw : ''
      commit(db, row, cell.columnId, cell.columnId === titleId ? (raw ?? '') : raw, info?.notice, keeps ? () => dropDraft(row.id, cell.columnId, sent) : undefined)
    }}
    onCancel={() => { setOpenCell(null); if (keeps) dropDraft(row.id, cell.columnId) }}
    onCreateOption={db.database.fixed ? undefined : property.target === todosSourceId ? namedTodo : name => createOption(run, db, property, name)}
    onRestoreTarget={property.target ? () => void run({ type: 'restore-page', pageId: property.target! }) : undefined} />
}

/** What a pasted line means in a cell: undefined when it means nothing there. An option is found by its name; a new one isn't made by a paste. */
function pastedValue(db: Database, property: Property, line: string): Json | undefined {
  const text = line.trim()
  if (line.length > 10_000) return undefined
  if (property.id === titleId || property.type === 'text') return line
  if (property.type === 'url' || property.type === 'email' || property.type === 'phone') return text
  if (isReadOnly(property)) return undefined
  if (property.type === 'number') { const n = Number(text.replace(/,/g, '')); return Number.isFinite(n) ? n : undefined }
  const option = (propertyOf(db, property.id)?.options ?? []).find(o => o.name.toLowerCase() === text.toLowerCase())
  if (property.type === 'select' || property.type === 'status') return option?.id
  if (property.type === 'multiSelect' || property.type === 'relation') return option ? [option.id] : undefined
  return undefined
}

/** To-dos named in a relation's pick list: nothing until the cell saves, in that one command, so one Undo takes both and one unticked first is never made (R3-25). */
const namedTodos = new Map<string, { id: string; title: string }>()
function namedTodo(title: string): string {
  const id = newId(), rowId = todoRowId(id)
  namedTodos.set(rowId, { id, title })
  return rowId
}
function createOption(run: ReturnType<typeof useWorkspace>['run'], db: Page & { database: Database }, property: Property, name: string): string {
  const id = newId()
  // A relation's "New row in Books…": a row of its target, which the pick then links.
  if (property.type === 'relation') { void run({ type: 'add-row', databaseId: property.target!, pageId: id, title: name, at: new Date().toISOString() }, null); return id }
  void run(ws => {
    const now = ws.pages.find(p => p.id === db.id)
    if (!isDatabase(now)) return null
    const options = [...(now.database.properties.find(p => p.id === property.id)?.options ?? [])]
    // Status: a new option goes at the end of To do (Jazz bf91cb72).
    const at = property.type === 'status' ? options.reduce((last, o, i) => (o.group ?? 'todo') === 'todo' ? i + 1 : last, 0) : options.length
    options.splice(at, 0, { id, name, ...(property.type === 'status' ? { group: 'todo' as const } : {}) })
    return { type: 'change-database', pageId: db.id, change: { kind: 'updateProperty', propertyId: property.id, options } }
  })
  return id
}

/** Where a URL, Email or Phone cell's words link to; null when they don't read as one, so they stay plain text. */
function linkHref(property: Property, text: string): string | null {
  return property.type === 'url' ? urlHref(text) : property.type === 'email' ? emailHref(text) : property.type === 'phone' ? phoneHref(text) : null
}
/** A cell's value as it shows now: what's still saving counts, in a calculation too. */
export function shownValue(db: Database, row: Page, columnId: string): CellValue {
  const pending = pendingCells.get(pendingKey(row.id, columnId)), property = propertyOf(db, columnId)
  return pending && property ? readValue(property, pending.raw) : cellValue(db, row, columnId)
}
/** A row's value as it shows now: one on its way, or kept after a failed save, comes first. */
export function shownRaw(row: Page, columnId: string): unknown {
  const pending = pendingCells.get(pendingKey(row.id, columnId))
  return pending ? pending.raw ?? null : rawOf(row, columnId)
}
/** The rows in the order they show: a dropped card is already where it's going while it saves. */
export function withPendingMoves(rows: readonly Page[]): Page[] {
  const out = [...rows]
  for (const p of pendingCells.values()) {
    if (p.beforeId === undefined) continue
    const from = out.findIndex(r => r.id === p.rowId)
    if (from < 0) continue
    const [row] = out.splice(from, 1)
    const to = p.beforeId === null ? -1 : out.findIndex(r => r.id === p.beforeId)
    out.splice(to < 0 ? out.length : to, 0, row!)
  }
  return out
}

/** What a group's name reads as: a status with its dot, a number in its format. No value is quiet. */
/** A sub-group's line (R3-13), set in one step under its group's, with its own fold and count. */
export function SubGroupHead({ groups, group, isFolded, onToggle, lane }: { groups: ViewGroups; group: ViewGroup; isFolded: boolean; onToggle: () => void; /** A board's first level, so it sits on the title's edge. */ lane?: boolean }) {
  return <div className={`database-group-inner${lane ? '' : ' is-sub'}`}>
    <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={onToggle}>
      <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
    </button>
  </div>
}
export function GroupName({ groups, group }: { groups: ViewGroups; group: ViewGroup }) {
  if (group.key === noGroupKey) return <span className="database-group-none">{group.name}</span>
  const { property } = groups
  if (property.type === 'status' || property.type === 'number') return <PropertyCell property={property} value={property.type === 'number' ? Number(group.key) : group.key} />
  return <span>{group.name}</span>
}
/** "Hidden: Done (12)" at the end of a view (design §7.3): a tap shows that group again. */
/** The second layer's hidden ones, over every row of the view. */
export function HiddenSubGroups({ db, view, rows, changeView, weekStart, underCards }: { db: Database; view: View; rows: readonly Page[]; changeView: ChangeView; weekStart: WeekStart; underCards?: boolean }) {
  const subs = viewSubGroups(db, view, rows, shownRaw, weekStart)
  if (!subs?.hidden.length) return null
  return <p className={`database-hidden-groups${underCards ? ' is-under-cards' : ''}`}>Hidden: {subs.hidden.map((g, i) => <span key={g.key}>{i > 0 && ' · '}<button type="button" className="app-link" onClick={() => changeView(current => ({ hiddenSubGroups: (current.hiddenSubGroups ?? []).filter(k => k !== g.key) }))}>{g.name} ({g.rows.length})</button></span>)}</p>
}
export function HiddenGroups({ groups, changeView, underCards }: { groups: ViewGroups; changeView: ChangeView; underCards?: boolean }) {
  if (!groups.hidden.length) return null
  return <p className={`database-hidden-groups${underCards ? ' is-under-cards' : ''}`}>Hidden: {groups.hidden.map((g, i) => <span key={g.key}>{i > 0 && ' · '}<button type="button" className="app-link" onClick={() => changeView(current => ({ hiddenGroups: (current.hiddenGroups ?? []).filter(k => k !== g.key) }))}>{g.name} ({g.rows.length})</button></span>)}</p>
}
/** The tables on screen, so `⋯` can start Select rows on one (R3-15). */
const pickStarters = new Map<string, () => void>()
export const startPicking = (blockId: string) => pickStarters.get(blockId)?.()
/** How many rows each group draws, for this tab: "Show 25 more" (design §13) under each group or column. */
export function useGroupLimits(blockId: string, cap: number) {
  const [limits, setLimits] = useState<Record<string, number>>(() => blockPlaces.get(blockId)?.groups ?? {})
  const set = (key: string, next: number) => setLimits(now => {
    const groups = { ...now, [key]: next }
    blockPlaces.set(blockId, { scrollLeft: blockPlaces.get(blockId)?.scrollLeft ?? 0, limit: blockPlaces.get(blockId)?.limit ?? cap, groups })
    return groups
  })
  const limitOf = (key: string) => limits[key] ?? cap
  return { limitOf, showMore: (key: string) => set(key, limitOf(key) + 25), reach: (key: string, at: number) => { if (at >= limitOf(key)) set(key, at + 1) } }
}

/**
 * A row moved within its group, or to another: within one is a `move-page`; to another is one `set-values` with its new
 * place, so one Undo takes back both. `before` is the row it goes in front of, or null for the end of the group.
 */
export function useMoveRow(db: Page & { database: Database }, view: View, context: ViewContext, groups: ViewGroups | null) {
  const { run, latest } = useWorkspace()
  const commit = useCommitCell()
  return (rowId: string, from: string | null, to: string | null, before: string | null, shown: readonly Page[]) => {
    const stored = latest()
    const ws = stored && db.database.fixed ? withTodos(stored) : stored
    const row = ws?.pages.find(p => p.id === rowId)
    if (!ws || !row || row.trashedAt) return
    // Sorted, a card's place comes from the sort: only its value changes.
    const sorted = view.sort.length > 0
    const all = databaseRows(ws, db.id), rest = all.filter(r => r.id !== rowId)
    const target = to === null || !groups ? undefined : viewSection(db.database, view, withPendingMoves(viewRows(ws, db.id, view, context)), to, shownRaw, context.weekStart)
    const last = target?.rows.filter(r => r.id !== rowId).at(-1)
    // The end of a group is just before whatever follows its last row; an empty group has no place to keep.
    const end = groups ? (last ? rest[rest.indexOf(rest.find(r => r.id === last.id)!) + 1]?.id ?? null : undefined) : null
    const beforeId = sorted ? undefined : before ?? end
    if (from === to) {
      // To-dos have no order of their own to keep.
      if (db.database.fixed) return
      // Dropped where it already is, as he sees it: nothing to send.
      const here = groups ? target?.rows ?? [] : shown
      const next = here[here.findIndex(r => r.id === rowId) + 1]?.id ?? null
      if (sorted || before === rowId || before === next || beforeId === undefined) return
      void run({ type: 'move-page', pageId: rowId, parentId: db.id, beforeId }, r => ({ text: 'Row moved', undoOperationId: r.operationId }))
      return
    }
    if (!groups || to === null || !target) return
    // Each layer the drop changed: a drag across both is one change with one Undo (R3-13).
    const was = from === null ? null : splitSection(from), now = splitSection(to), subProperty = viewSubGroupBy(db.database, view)
    const layers = [
      ...(was?.group !== now.group ? [{ property: groups.property, key: now.group, fromKey: was?.group, by: view.groupDateBy }] : []),
      ...(subProperty && now.sub !== undefined && was?.sub !== now.sub ? [{ property: subProperty, key: now.sub, fromKey: was?.sub, by: view.subGroupDateBy }] : []),
    ]
    const stuck = layers.find(l => isReadOnly(l.property))
    if (stuck) { toast(`${stuck.property.name} can't be changed`, { timeout: 4000 }); return }
    const moved = layers.map(l => ({ id: l.property.id, value: groupValue(l.property, l.key, shownRaw(row, l.property.id), l.fromKey, context.today, l.by, context.weekStart) }))
    const probe = { ...row, values: { ...row.values } } as Page
    for (const { id, value } of moved) { if (value === undefined) delete probe.values![id]; else probe.values![id] = value }
    const hidden = !inView(db.database, probe, view, context)
    const notice = `Moved to ${target.name}${hidden ? " · hidden by this view's filter" : ''}`
    if (moved.length === 1) { commit(db, row, moved[0]!.id, moved[0]!.value, notice, undefined, beforeId); return }
    // To-dos have a command per column, so there it's one each, each reading what the last one left.
    if (db.database.fixed) {
      const taskId = taskIdOfRow(row.id), sends = taskId ? todoMoves(ws, taskId, moved) : moved
      const send = (i: number) => { const m = sends[i]; if (m) commit(db, row, m.id, m.value, undefined, () => send(i + 1)) }
      send(0)
      return
    }
    commit(db, row, moved[0]!.id, moved[0]!.value, notice, undefined, beforeId, moved.slice(1).map(m => ({ columnId: m.id, raw: m.value })))
  }
}

/** A to-do's box, on its row in any layout: the same tick as on its line (R2-9). A cancelled one's stays disabled, as on his rows. */
export function TodoTick({ row }: { row: Page }) {
  const taskId = taskIdOfRow(row.id)
  return taskId ? <TodoBox taskId={taskId} title={displayPageTitle(row)} /> : null
}
function TodoBox({ taskId, title }: { taskId: string; title: string }) {
  const tick = useTaskTick(taskId)
  return <PropertyCheckbox checked={tick.status === 'done'} disabled={tick.status === 'cancelled'} label={`Done: ${title}`}
    onToggle={() => tick.toggle((to, r) => ({ text: to === 'done' ? 'Done' : 'Reopened', undoOperationId: r.operationId }))} />
}

/** Opening a row remembers it, so Back tints it for a second where he left it (design §5). */
export function useOpenRow() {
  const navigate = useNavigate()
  const { latest } = useWorkspace()
  return (rowId: string, focus?: 'title') => {
    // A to-do has no page of its own: it opens on its line (design §11).
    const taskId = taskIdOfRow(rowId), ws = latest()
    if (taskId) {
      const line = ws ? todoLine(ws, taskId) : null
      if (line) void navigate({ to: '/pages', search: { page: line.pageId, block: line.lineId } })
      else toast("This to-do's line is gone", { timeout: 6000 })
      return
    }
    try { sessionStorage.setItem(returnKey, rowId) } catch { /* private mode */ } void navigate({ to: '/pages', search: { page: rowId, ...(focus ? { focus } : {}) } }) }
}
/** The row he's just come back from, for a second. */
export function useReturnedRow(rows: readonly Page[]): string | null {
  const [returned, setReturned] = useState<string | null>(null)
  useEffect(() => {
    let id: string | null = null
    try { id = sessionStorage.getItem(returnKey) } catch { /* private mode */ }
    if (!id || !rows.some(r => r.id === id)) return
    sessionStorage.removeItem(returnKey)
    setReturned(id)
    const t = setTimeout(() => setReturned(null), 1000)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return returned
}
/** What `+ New` in To-dos was tapped in, while its words are typed. */
let newTodoDraft: { view: View; context: ViewContext; group: string | undefined; values: Record<string, Json> | undefined } | null = null
/** `+ New` in To-dos, once it has words (design §11, R2-11): a task on the day's page, made from his template if it isn't there yet. */
function useAddTodo() {
  const { run, latest } = useWorkspace()
  const openRow = useOpenRow()
  return async (words: string) => {
    const draft = newTodoDraft, title = words.trim()
    newTodoDraft = null
    if (!draft || !title) return
    const { date, attentionOn, deadlineOn, status, visible } = newTodo(draft.view, draft.context, draft.group, draft.values)
    if (!await run({ type: 'ensure-day', date }, null, newId(), { quiet: true })) return
    const made = await run({ type: 'add-task', pageId: `day:${date}`, title, plannedOn: date, ...(attentionOn ? { attentionOn } : {}), ...(deadlineOn ? { deadlineOn } : {}) },
      r => ({ text: visible ? 'Added' : "Added · hidden by this view's filter", extra: { label: 'Open', run: () => openRow(todoRowId(r.entityId ?? '')) } }))
    const ws = latest()
    const change = made?.entityId && status && ws ? todoChange(ws, made.entityId, 'status', status, todayIso()) : null
    if (change && 'action' in change) void run(change.action, r => ({ text: change.notice, undoOperationId: r.operationId }))
  }
}
/**
 * `+ New` (design §3.1, §7.4), under a view or a group: with the values that keep it in sight, and the notice when none
 * do. On the phone it opens as its page with the caret in its title; at 1280 its Name opens to be typed, once it's drawn.
 */
export function useAddRow(db: Page & { database: Database }, view: View, context: ViewContext, blockId: string, reveal: (rowId: string, group: string | undefined) => void) {
  const { run, latest } = useWorkspace()
  const navigate = useNavigate()
  const openRow = useOpenRow()
  const wide = useWide()
  /** `values`: what its place says, over what the view's filter asks: a calendar day's date. `template`: one picked, or null for an empty row; else the default. */
  return (group?: string, values?: Record<string, Json>, template?: string | null) => {
    // Raise the keyboard inside this tap, for the row's page.
    if (!wide) holdKeyboard()
    // A to-do needs its words first: a blank one isn't a row, and shouldn't exist (B69).
    if (db.database.fixed) {
      newTodoDraft = { view, context, group, values }
      setOpenCell({ blockId, databaseId: db.id, rowId: newTodoRowId, columnId: titleId })
      return
    }
    const prefill = newRowValues(db.database, view, context, group)
    if (values) {
      Object.assign(prefill.values, values)
      prefill.visible = inView(db.database, newRowProbe(db.database, prefill.title, prefill.values), view, context)
    }
    const ws = latest()
    const from = template === null || !ws ? undefined : template ? ws.pages.find(p => p.id === template) : defaultRowTemplate(ws, db, view)
    if (from) prefill.visible = inView(db.database, newRowProbe(db.database, prefill.title || from.title, { ...templateValues(from), ...prefill.values }), view, context)
    const pageId = newId()
    void run({ type: 'add-row', databaseId: db.id, pageId, title: prefill.title, values: prefill.values, ...(from ? { template: from.id } : {}), at: new Date().toISOString() },
      r => prefill.visible ? null : { text: "Added · hidden by this view's filter", extra: { label: 'Show', run: () => void navigate({ to: '/pages', search: { page: r.entityId ?? pageId } }) } })
      .then(r => {
        if (!r) return
        if (!wide) { openRow(pageId, 'title'); return }
        if (!prefill.visible) return
        // An empty group's first row is drawn in a section as soon as it's there, so its Name opens under that section's key.
        const now = latest(), lone = group !== undefined && splitSection(group).sub === undefined && viewSubGroupBy(db.database, view) && now
        reveal(pageId, (lone ? viewSections(db.database, view, viewRows(now, db.id, view, context), undefined, context.weekStart)?.shown.find(s => splitSection(s.key).group === group && s.rows.some(r => r.id === pageId))?.key : undefined) ?? group)
      })
  }
}
/** `+ New`, and its `⌄` for the database's templates (R3-12). To-dos are made from words, so they have none. */
export function NewRow({ db, blockId, addRow, group, className = 'database-new' }: { db: Page & { database: Database }; blockId: string; addRow: ReturnType<typeof useAddRow>; group?: string; className?: string }) {
  return <>
    <button type="button" className={className} onClick={() => addRow(group)}>+ New</button>
    {!db.database.fixed && <button type="button" className="database-new-more" aria-label="New from a template" aria-haspopup="menu" onClick={() => openDatabaseMenu(blockId, db.id, 'templates', template => addRow(group, undefined, template))}><ChevronDownIcon /></button>}
  </>
}
/** ⌘Z in a view: the last change, where the workspace's one Undo slot still holds it (design §10). True when it took the key. */
export function useUndoKey() {
  const { run, latest } = useWorkspace()
  return (e: KeyboardEvent<HTMLElement>): boolean => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement).tagName === 'INPUT') return false
    e.preventDefault()
    const undo = latest()?.undo
    if (undo) void run({ type: 'undo', targetOperationId: undo.operationId }, { text: 'Undone' }, undefined, { inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => toast("Can't undo · edited since", { timeout: 6000 }) })
    else toast("Can't undo · edited since", { timeout: 6000 })
    return true
  }
}
/** Under any view: a filter that matches nothing, and changes that weren't saved (design §13). */
export function ViewNotes({ db, view, changeView, empty }: { db: Page; view: View; changeView: ChangeView; empty: boolean }) {
  usePendingCells()
  const failedHere = [...pendingCells.values()].filter(p => p.failed && !p.part && p.databaseId === db.id)
  return <>
    {empty && view.filter.length > 0 && <p className="database-empty">No rows match this view · <button type="button" className="app-link" onClick={() => changeView(() => ({ filter: [] }))}>Clear filter</button></p>}
    {failedHere.length > 0 && <p className="database-unsaved" role="status">{failedHere.length === 1 ? '1 change' : `${failedHere.length} changes`} not saved · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.retry())}>Retry</button> · <button type="button" className="app-link" onClick={() => failedHere.forEach(f => f.discard())}>Undo</button></p>}
  </>
}

/**
 * ⌘C, ⌘X and ⌘V in a board or list are about it, never the page around it (design §10), as in a table: they stop at the
 * window, before the page's clipboard handlers. Copy takes the row's title; a row isn't cut or pasted over here.
 */
export function useViewClipboard(wrap: { current: HTMLElement | null }) {
  useEffect(() => {
    const handle = (e: ClipboardEvent) => {
      const focused = document.activeElement
      if (!wrap.current?.contains(focused)) return
      e.stopPropagation()
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (e.type === 'copy' && focused?.closest('[data-card], [data-row]')) e.clipboardData?.setData('text/plain', focused.textContent ?? '')
    }
    for (const type of ['copy', 'cut', 'paste'] as const) window.addEventListener(type, handle, true)
    return () => { for (const type of ['copy', 'cut', 'paste'] as const) window.removeEventListener(type, handle, true) }
  }, [wrap])
}

/** Which groups are folded in a table or list: on this device only, per view of a block, never a save or an Undo, like the view shown. */
function foldKey(blockId: string, viewId: string) { return `daythread.database-fold.${blockId}.${viewId}` }
export function useFolds(blockId: string, viewId: string) {
  const read = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(foldKey(blockId, viewId)) ?? '[]') as string[]) } catch { return new Set<string>() } }
  const [folded, setFolded] = useState(read)
  useEffect(() => setFolded(read()), [blockId, viewId]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key: string) => {
    const next = new Set(folded)
    if (!next.delete(key)) next.add(key)
    setFolded(next)
    try { localStorage.setItem(foldKey(blockId, viewId), JSON.stringify([...next])) } catch { /* private mode: this tab only */ }
  }
  return { folded, toggle }
}

/** The table view (design §4.1, §4.2): Name first, then the view's shown properties; `+ New` under the rows. */
export interface DatabaseViewProps { workspace: Workspace; db: Page & { database: Database }; blockId: string; pageDate: string | null; cap: number; showTitle?: boolean; linked?: LinkedHeader }
/** A linked view's own title and the line under it (design §9.2). */
export interface LinkedHeader { title: string; rename(title: string): void; source: ReactNode }
/** The view a block shows, and how to change it, drawn in its layout. */
function DatabaseView(props: DatabaseViewProps) {
  useShownViews()
  const view = shownView(props.db.database, props.blockId)
  const changeView = useViewChange(props.db.id, view.id)
  return <LaidOutView {...props} view={view} changeView={changeView} />
}
/** A view in its layout, for a home block and a linked view alike. */
export function LaidOutView(props: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  if (props.view.layout === 'board') return <DatabaseBoard {...props} />
  if (props.view.layout === 'list') return <DatabaseList {...props} />
  if (props.view.layout === 'gallery') return <DatabaseGallery {...props} />
  if (props.view.layout === 'calendar') return <DatabaseCalendar {...props} />
  return <DatabaseTable {...props} />
}

/** Above a view's rows, whatever its layout: the title, its view and `⋯` buttons, and the line of rules. */
export function DatabaseHeader({ db, view, changeView, blockId, showTitle, linked, onTitleEnter }: { db: Page & { database: Database }; view: View; changeView: ChangeView; blockId: string; showTitle: boolean; linked?: LinkedHeader; onTitleEnter(): void }) {
  const { run } = useWorkspace()
  const rename = (title: string) => {
    if (linked) { if (title !== linked.title) linked.rename(title); return }
    if (title !== db.title) void run({ type: 'rename-page', pageId: db.id, title })
  }
  const titleInput = useRef<HTMLInputElement>(null)
  useSaveOnHide(() => { if (titleInput.current && document.activeElement === titleInput.current) rename(titleInput.current.value.trim()) })
  return <>
    {!showTitle && <div className="database-title-row is-page"><DatabaseViewsButton blockId={blockId} databaseId={db.id} name={view.name} /><DatabaseMenuButton blockId={blockId} databaseId={db.id} /></div>}
    {showTitle && <div className="database-title-row">
      <input ref={titleInput} className="database-title" data-database={linked ? undefined : db.id} aria-label={linked ? 'View name' : 'Database name'} placeholder="Untitled database" defaultValue={linked ? linked.title : db.title} key={linked ? linked.title : db.title}
        onBlur={e => rename(e.currentTarget.value.trim())}
        // Enter in a new database's title goes on to its first row's Name (design §3.1).
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.currentTarget.blur(); onTitleEnter() } }} />
      {linked ? <span className="database-view-name is-static">{view.name}</span> : <DatabaseViewsButton blockId={blockId} databaseId={db.id} name={view.name} />}
      <DatabaseMenuButton blockId={blockId} databaseId={db.id} />
    </div>}
    {linked?.source}
    {(view.filter.length > 0 || view.sort.length > 0) && <RulesLine db={db.database} view={view} blockId={blockId} databaseId={db.id} onChange={changeView} />}
  </>
}

export function DatabaseTable({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { run, latest } = useWorkspace()
  const navigate = useNavigate()
  const commit = useCommitCell()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const columns = viewColumns(db.database, view)
  const place = blockPlaces.get(blockId)
  const [limit, setLimitState] = useState(place?.limit ?? cap)
  const setLimit = (next: number) => { setLimitState(next); blockPlaces.set(blockId, { scrollLeft: blockPlaces.get(blockId)?.scrollLeft ?? 0, limit: next }) }
  // Sideways scroll comes back after a redraw, so an edit never sends him back to Name (Jazz 8985f9e7).
  const scroller = (el: HTMLDivElement | null) => { const left = blockPlaces.get(blockId)?.scrollLeft; if (el && left && el.scrollLeft !== left) el.scrollLeft = left }
  const onScroll = (e: UIEvent<HTMLDivElement>) => blockPlaces.set(blockId, { limit, scrollLeft: e.currentTarget.scrollLeft })
  const open = (rowId: string, columnId: string, group?: string) => setOpenCell({ blockId, databaseId: db.id, rowId, columnId, ...(group !== undefined ? { group } : {}) })
  usePendingCells()
  // Rows in their groups, with a change on its way already in its new group (R2-13).
  const groups = viewGroups(db.database, view, withPendingMoves(rows), shownRaw, weekStart)
  const { limitOf, showMore, reach } = useGroupLimits(`${blockId}|${view.id}`, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  const moveRow = useMoveRow(db, view, context, groups)
  const wide = useWide()
  const openRow = useOpenRow()
  const returned = useReturnedRow(rows)
  const [reveal, setReveal] = useState<string | null>(null)
  // Several rows at 1280 (design §12): a box on hover at each row's left, Shift for a range, then the bar.
  // On the phone (R3-15) there's no hover: `⋯` → Select rows or a long-press on a Name starts it, and a tap then ticks a row.
  const [picked, setPicked] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  useEffect(() => { pickStarters.set(blockId, () => setPicking(true)); return () => { pickStarters.delete(blockId) } }, [blockId])
  const stopPicking = () => { setPicking(false); setPicked([]) }
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  // A long press that started picking mustn't then open the row it was on.
  const justHeld = useRef(false)
  const startHold = (e: ReactPointerEvent, rowId: string) => {
    if (wide || picking || db.database.fixed || e.pointerType === 'mouse') return
    const { clientX: x, clientY: y } = e
    held.current = { x, y, timer: setTimeout(() => { held.current = null; justHeld.current = true; setPicking(true); setPicked([rowId]) }, 450) }
  }
  const moveHold = (e: ReactPointerEvent) => { if (held.current && Math.hypot(e.clientX - held.current.x, e.clientY - held.current.y) > 8) endHold() }
  const endHold = () => { if (held.current) clearTimeout(held.current.timer); held.current = null }
  const tapWhilePicking = (e: ReactMouseEvent) => {
    if (justHeld.current) { justHeld.current = false; e.preventDefault(); e.stopPropagation(); return }
    if (!picking) return
    const rowId = (e.target as Element).closest<HTMLElement>('tr.database-row')?.dataset.row
    if (!rowId) return
    e.preventDefault(); e.stopPropagation()
    setPicked(p => (p.includes(rowId) ? p.filter(x => x !== rowId) : [...p, rowId]))
  }
  const lastPicked = useRef<string | null>(null)
  const pick = (rowId: string, shift: boolean) => {
    const ids = shown.map(r => r.id)
    if (shift && lastPicked.current && ids.includes(lastPicked.current)) {
      const [a, b] = [ids.indexOf(lastPicked.current), ids.indexOf(rowId)].sort((x, y) => x - y)
      setPicked(p => [...new Set([...p, ...ids.slice(a!, b! + 1)])])
    } else setPicked(p => (p.includes(rowId) ? p.filter(x => x !== rowId) : [...p, rowId]))
    lastPicked.current = rowId
  }
  const deletePicked = () => {
    const ids = picked.filter(id => rows.some(r => r.id === id))
    setPicked([]); setPicking(false)
    if (ids.length) void run({ type: 'delete-pages', pageIds: ids, at: new Date().toISOString() }, r => ({ text: ids.length === 1 ? 'Row deleted' : `${ids.length} rows deleted`, undoOperationId: r.operationId }))
  }
  // Rows drag by their ⋮⋮ only while the view isn't sorted (design §7.2); the drop is a move-page among the rows.
  const [drag, setDrag] = useState<{ rowId: string; from: string | null; before: string | null; group: string | null } | null>(null)
  const tbody = useRef<HTMLTableSectionElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const startDrag = (e: ReactPointerEvent, rowId: string, from: string | null) => {
    if (view.sort.length) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    // The row under the pointer, or a group's foot for the end of that group.
    const target = (y: number): { before: string | null; group: string | null } => {
      const trs = [...(tbody.current?.querySelectorAll<HTMLTableRowElement>('tr.database-row, tr.database-group-foot') ?? [])]
      const tr = trs.find(t => { const r = t.getBoundingClientRect(); return y < r.top + r.height / 2 })
      return { before: tr?.classList.contains('database-row') ? tr.dataset.row ?? null : null, group: (tr ?? trs.at(-1))?.dataset.group ?? null }
    }
    setDrag({ rowId, from, ...target(e.clientY) })
    const move = (ev: PointerEvent) => setDrag({ rowId, from, ...target(ev.clientY) })
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (ev.type === 'pointercancel') return
      const { before, group } = target(ev.clientY)
      moveRow(rowId, from, group, before, entries.map(x => x.row))
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  useEffect(() => {
    if (!reveal) return
    const row = tbody.current?.querySelector(`[data-row="${CSS.escape(reveal)}"]`)
    if (row) { row.scrollIntoView({ block: 'nearest' }); setReveal(null) }
  }, [reveal, rows, limit])
  const key = (rowId: string, columnId: string, group?: string) => cellKey({ blockId, databaseId: db.id, rowId, columnId, ...(group !== undefined ? { group } : {}) })

  const addRow = useAddRow(db, view, context, blockId, (pageId, group) => {
    // Past the rows shown, the new row is drawn all the same, and brought into view (Lead's review, 5).
    const ws = latest(), now = ws ? viewRows(ws, db.id, view, context) : []
    if (group === undefined) { const at = now.findIndex(x => x.id === pageId); if (at >= limit) setLimit(at + 1) }
    else reach(group, ws ? viewSections(db.database, view, now, undefined, weekStart)?.shown.find(g => g.key === group)?.rows.length ?? 0 : 0)
    setReveal(pageId)
    requestAnimationFrame(() => open(pageId, titleId, group))
  })
  const addProperty = () => {
    const id = newId()
    void run(ws => {
      const now = ws.pages.find(p => p.id === db.id)
      return isDatabase(now) ? { type: 'change-database', pageId: db.id, change: { kind: 'addProperty', property: { id, name: uniqueName(now.database), type: 'text' }, ...(linked ? {} : { viewId: view.id }) } } : null
    })
    // A linked view shows it in its own columns; the source's views only list it.
    if (linked) changeView(current => ({ columns: [...current.columns, { id }] }))
  }

  // What's drawn, in order: a Multi-select's row once in each of its groups, so a row's place is its index here.
  // Each group, with its sub-groups if the view has them; rows are drawn per section, under the section's key.
  const layers = groups?.shown.map(group => ({ group, subs: viewSubGroups(db.database, view, group.rows, shownRaw, weekStart) }))
  const drawn = (key: string, all: readonly Page[]) => (folded.has(key) ? [] : all.slice(0, limitOf(key)))
  const entries: { row: Page; group?: string }[] = layers ? layers.flatMap(({ group, subs }) => folded.has(group.key) ? [] : subs && group.rows.length
    ? subs.shown.flatMap(sub => { const key = sectionKey(group.key, sub.key); return drawn(key, sub.rows).map(row => ({ row, group: key })) })
    : drawn(group.key, group.rows).map(row => ({ row, group: group.key }))) : rows.slice(0, limit).map(row => ({ row }))
  const shown = entries.map(e => e.row)
  // What All picks: not the rows in a group he hid. A row in two groups counts once.
  const pickable = [...new Set((layers ? layers.flatMap(({ group, subs }) => (subs && group.rows.length ? subs.shown.flatMap(sub => sub.rows) : group.rows)) : rows).map(r => r.id))]
  const undoKey = useUndoKey()
  /**
   * Keys in the table at 1280 (design §10): arrows move the cell cursor, Tab/Shift-Tab along a row, Enter opens the
   * cell (a button's own Enter), Delete clears it, Esc gives the block back to the page selected whole, and ⌘Z undoes
   * the last change where the workspace's one Undo slot still holds it.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if (undoKey(e)) return
    // ⌘A on a cell selects nothing: the browser's select-all would take the page around it, and the next key replace it.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
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
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing on a text, number or URL cell (or Name) starts replacing its value (design §10).
      const row = shown[r], property = c === 0 ? titleProperty : columns[c - 1]?.property
      if (!row || !property || !['text', 'number', 'url', 'email', 'phone'].includes(property.type)) return
      e.preventDefault()
      open(row.id, property.id, entries[r]!.group)
      // Space opens the cell as it is; any other key starts replacing it.
      if (e.key !== ' ') typeInto(e.key)
    }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && c > 0) {
      const row = shown[r], property = columns[c - 1]?.property
      if (row && property && !isReadOnly(property) && !isEmptyValue(cellValue(db.database, row, property.id))) { e.preventDefault(); commit(db, row, property.id, undefined) }
    }
  }
  /**
   * ⌘C, ⌘X and ⌘V with focus in the table are about the table, never the page around it (design §10): they stop at the
   * window, before the page's clipboard handlers, which act on the block the page's selection is on. On a cell, copy
   * and cut take its value (a cut clears it, as Delete does), and paste sets it from the first line (§6.3).
   */
  const onClipboard = (e: ClipboardEvent) => {
    const focused = document.activeElement
    if (!wrap.current?.contains(focused)) return
    e.stopPropagation()
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
    e.preventDefault()
    const nav = focused?.closest<HTMLElement>('[data-nav]')?.dataset.nav
    if (!nav) return
    const [r, c] = nav.split(':').map(Number) as [number, number]
    const row = shown[r], property = c === 0 ? titleProperty : columns[c - 1]?.property
    if (!row || !property) return
    const value = c === 0 ? (row.title || null) : cellValue(db.database, row, property.id)
    if (e.type !== 'paste') {
      e.clipboardData?.setData('text/plain', valueText(db.database, property.id, value))
      if (e.type === 'cut' && c > 0 && !isReadOnly(property) && !isEmptyValue(value)) commit(db, row, property.id, undefined)
      return
    }
    const lines = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n$/, '').split(/\r?\n/), first = lines[0]!
    if (!first.trim()) return
    const raw = pastedValue(db.database, property, first)
    if (raw === undefined) { toast(`Can't paste that into ${property.name}`, { timeout: 6000 }); return }
    commit(db, row, property.id, raw)
    if (lines.length > 1) toast('Pasted the first line only', { timeout: 6000 })
  }
  const clipboardHandler = useRef(onClipboard)
  clipboardHandler.current = onClipboard
  useEffect(() => {
    const handle = (e: ClipboardEvent) => clipboardHandler.current(e)
    // On the window: React's own capture listeners are on the document, as the app renders the whole document.
    for (const type of ['copy', 'cut', 'paste'] as const) window.addEventListener(type, handle, true)
    return () => { for (const type of ['copy', 'cut', 'paste'] as const) window.removeEventListener(type, handle, true) }
  }, [])
  // The foot appears once a column has a calculation (design §4.1a): nothing at rest for a table that has none.
  const calculations = viewCalculations(db.database, view)
  const footColumns = [propertyOf(db.database, titleId)!, ...columns.map(c => c.property)]
  const hasFoot = footColumns.some(p => calculations[p.id])
  const readShown = (row: Page, columnId: string) => shownValue(db.database, row, columnId)
  const footRow = (over: readonly Page[]) => <tr className="database-calc">
    {footColumns.map(property => {
      const kind = calculations[property.id]
      const text = kind ? calcText(kind, columnCalc(db.database, over, property.id, kind, readShown), property.format, today, property.prefix) : null
      return <td key={property.id} className={`database-td is-${property.id === titleId ? 'title' : property.type}`}>
        {(text || wide) && <button type="button" className="database-cell database-calc-cell" aria-label={text ? `${property.name}: ${text.label} ${text.value}` : `Calculate ${property.name}`} onClick={() => openDatabaseMenu(blockId, db.id, 'calculate')}>
          {text ? <span className="database-calc-text">{text.label && <span className="database-calc-label">{text.label}</span>}<span>{text.value}</span></span> : <span className="database-calc-empty">Calculate</span>}
        </button>}
      </td>
    })}
    <td className="database-td is-add" />
  </tr>
  const rowLine = (row: Page, index: number, group?: string) => <tr key={`${group ?? ''}:${row.id}`} data-row={row.id} {...(group !== undefined ? { 'data-group': group } : {})} className={`database-row${returned === row.id ? ' is-returned' : ''}${picked.includes(row.id) ? ' is-picked' : ''}${drag?.before === row.id && drag.rowId !== row.id && (drag.group ?? undefined) === group ? ' is-drop-before' : ''}${drag?.rowId === row.id ? ' is-dragging' : ''}`}>
            <td className={`database-td is-title${view.wrapName ? ' is-wrapped' : ''}`}><div className="database-title-inner">
              {wide && <span className="database-pin-strip" />}
              {wide && !db.database.fixed && <span className="database-row-gutter">
                {!view.sort.length && <span className="database-row-handle" role="button" aria-label={`Drag ${displayPageTitle(row)}`} onPointerDown={e => startDrag(e, row.id, group ?? null)}>⋮⋮</span>}
                <input type="checkbox" className="database-row-pick" aria-label={`Select ${displayPageTitle(row)}`} checked={picked.includes(row.id)} onChange={() => undefined} onClick={e => pick(row.id, e.shiftKey)} />
              </span>}
              {/* A row opens as a page, from Name, at both widths (design §5). */}
              {picking && <input type="checkbox" className="database-row-tick" tabIndex={-1} aria-label={`Select ${displayPageTitle(row)}`} checked={picked.includes(row.id)} readOnly />}
              <TodoTick row={row} />
              <button type="button" className="database-title-cell" data-cell={key(row.id, titleId, group)} data-nav={`${index}:0`} onPointerDown={e => startHold(e, row.id)} onPointerMove={moveHold} onPointerUp={endHold} onPointerCancel={endHold} onContextMenu={e => { if (!wide) e.preventDefault() }} onClick={() => openRow(row.id)}>
                <span className={row.title ? '' : 'is-placeholder'}>{row.title || 'Untitled'}</span>
              </button>
              <button type="button" className="database-open" onClick={() => openRow(row.id)}>Open</button>
            </div></td>
            {columns.map(({ property, wrap }, col) => {
              const wraps = Boolean(wrap) && canWrap(property.type)
              const pending = pendingCells.get(pendingKey(row.id, property.id))
              // His value stays shown while it saves and after a failed save, never a silent revert (design §13).
              const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
              const navId = `${index}:${col + 1}`
              return <td key={property.id} className={`database-td is-${property.type}${wraps ? ' is-wrapped' : ''}${pending?.failed ? ' is-unsaved' : pending ? ' is-saving' : ''}`}>
                {property.type === 'checkbox'
                  ? <span data-nav={navId} tabIndex={0} className="database-check-cell" onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); commit(db, row, property.id, value === true ? undefined : true) } }}>
                      <PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />
                    </span>
                  : isReadOnly(property)
                  ? <span data-nav={navId} tabIndex={0} className="database-cell is-read-only"><PropertyCell property={property} value={value} today={today} /></span>
                  : wide && typeof value === 'string' && linkHref(property, value)
                  // At 1280 a link opens from its text, and the pencil edits it (design §6.1, Jazz bf91cb72).
                  ? <span className="database-url-cell">
                      <a href={linkHref(property, value)!} target="_blank" rel="noreferrer" className="database-url-link"><PropertyCell property={property} value={value} today={today} wrap={wraps} /></a>
                      <button type="button" className="database-url-edit" aria-label={`Edit ${property.name}`} data-cell={key(row.id, property.id, group)} data-nav={navId} onClick={() => open(row.id, property.id, group)}>✎</button>
                    </span>
                  : <button type="button" className="database-cell" data-cell={key(row.id, property.id, group)} data-nav={navId} onClick={() => open(row.id, property.id, group)}>
                      <PropertyCell property={property} value={value} today={today} wrap={wraps} />
                    </button>}
              </td>
            })}
            <td className="database-td is-add" />
          </tr>
  return <div className={`database-table-wrap${db.database.fixed ? ' is-todos' : ''}`} ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow() }} />
    <div className="database-scroll" ref={scroller} onScroll={onScroll}>
      <table className={`database-table${view.wrapName || columns.some(c => c.wrap && canWrap(c.property.type)) ? ' has-wrap' : ''}`} style={{ width: `calc(var(--database-name-width) + ${columns.reduce((sum, c) => sum + (c.width ?? defaultWidth(c.property)), addColumnWidth)}px)` }}>
        <thead>
          <tr>
            <th scope="col" className="database-th is-title" data-type="title">{wide && <span className="database-pin-strip" />}Name</th>
            {columns.map(c => <th key={c.property.id} scope="col" className="database-th" data-type={c.property.type} style={{ width: c.width ?? defaultWidth(c.property) }}>{c.property.name}</th>)}
            {!db.database.fixed && <th scope="col" className="database-th is-add"><button type="button" aria-label="Add property" onClick={addProperty}>+</button></th>}
          </tr>
        </thead>
        <tbody ref={tbody} className={!groups && drag && drag.before === null ? 'is-drop-end' : undefined} onPointerDownCapture={() => { justHeld.current = false }} onClickCapture={tapWhilePicking}>
          {layers ? layers.map(({ group, subs }) => {
            const isFolded = folded.has(group.key)
            const body = (key: string, all: readonly Page[]) => {
              if (folded.has(key)) return null
              const inGroup = drawn(key, all), start = entries.findIndex(e => e.group === key), more = all.length > inGroup.length
              return <>
                {inGroup.map((row, i) => rowLine(row, start + i, key))}
                {hasFoot && footRow(all)}
                <tr className={`database-group-foot${drag && drag.before === null && drag.group === key ? ' is-drop-end' : ''}`} data-group={key}><td colSpan={columns.length + 2}>
                  <div className="database-group-inner">
                    {more && <button type="button" className="database-more" onClick={() => showMore(key)}>Show 25 more</button>}
                    <span className="database-new-row"><NewRow db={db} blockId={blockId} addRow={addRow} group={key} /></span>
                  </div>
                </td></tr>
              </>
            }
            return <Fragment key={group.key}>
              <tr className="database-group"><th scope="rowgroup" colSpan={columns.length + 2} className="database-group-head">
                <div className="database-group-inner">
                  <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
                    <ChevronRightIcon /><GroupName groups={groups!} group={group} /><span className="database-group-count">· {group.rows.length}</span>
                  </button>
                </div>
              </th></tr>
              {!isFolded && (subs && group.rows.length
                ? subs.shown.map(sub => { const key = sectionKey(group.key, sub.key); return <Fragment key={key}>
                    <tr className="database-group"><th scope="rowgroup" colSpan={columns.length + 2} className="database-group-head"><SubGroupHead groups={subs} group={sub} isFolded={folded.has(key)} onToggle={() => toggle(key)} /></th></tr>
                    {body(key, sub.rows)}
                  </Fragment> })
                : body(group.key, group.rows))}
            </Fragment>
          }) : entries.map((e, i) => rowLine(e.row, i))}
        </tbody>
        {!groups && hasFoot && <tfoot>{footRow(rows)}</tfoot>}
      </table>
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {(picked.length > 0 || picking) && <div className={`database-picked-bar${picking ? ' is-picking' : ''}`} role="toolbar" aria-label="Selected rows">
      <span>{picked.length === 1 ? '1 row' : `${picked.length} rows`}</span>
      {picked.length > 0 && <EditPickedButton db={db} rowIds={picked} />}
      {picked.length > 0 && <button type="button" className="app-link is-danger" onClick={deletePicked}>Delete</button>}
      {picking && picked.length < pickable.length && <button type="button" className="app-link" onClick={() => setPicked(pickable)}>All</button>}
      <button type="button" className="app-link" onClick={stopPicking}>Done</button>
    </div>}
    {groups && <HiddenGroups groups={groups} changeView={changeView} />}
    {groups && <HiddenSubGroups db={db.database} view={view} rows={withPendingMoves(rows)} changeView={changeView} weekStart={weekStart} />}
    {!groups && rows.length > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    {!groups && <NewRow db={db} blockId={blockId} addRow={addRow} />}
  </div>
}

/**
 * "Edit property ▾" on the selected rows' bar (design §12): pick a property, then its editor; the value goes to every
 * selected row as one change and one Undo (set-values-many), each row checked against what it held.
 */
function EditPickedButton({ db, rowIds }: { db: Page & { database: Database }; rowIds: string[] }) {
  const { workspace, run } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [property, setProperty] = useState<Property | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const rows = (workspace?.pages ?? []).filter(p => rowIds.includes(p.id) && !p.trashedAt)
  const apply = (raw: Json | undefined) => {
    const p = property!
    setProperty(null)
    const items = rows.map(r => ({ pageId: r.id, values: { [p.id]: raw ?? null } as Record<string, Json>, expected: { [p.id]: (rawOf(r, p.id) ?? null) as Json } }))
    if (items.length) void run({ type: 'set-values-many', items, at: new Date().toISOString() }, r => ({ text: `${p.name} set on ${items.length === 1 ? '1 row' : `${items.length} rows`}`, undoOperationId: r.operationId }))
  }
  const editable = db.database.properties.filter(p => !isReadOnly(p))
  return <>
    <button type="button" ref={anchor} className="app-link" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Edit property ▾</button>
    {open && <div className="app-menu database-picked-menu" role="menu">
      {editable.map(p => <button key={p.id} type="button" role="menuitem" onClick={() => { setOpen(false); setProperty(p) }}>{p.name}</button>)}
    </div>}
    {property && property.type === 'checkbox' && <span className="database-picked-check">
      <button type="button" className="app-link" onClick={() => apply(true)}>Check all</button>
      <button type="button" className="app-link" onClick={() => apply(undefined)}>Uncheck all</button>
    </span>}
    {property && property.type !== 'checkbox' && rows[0] && <PropertyEditor property={property} value={null} rowTitle={rows.length === 1 ? displayPageTitle(rows[0]) : `${rows.length} rows`} anchor={anchor.current}
      onCommit={raw => apply(raw)} onCancel={() => setProperty(null)}
      onCreateOption={property.target === todosSourceId ? undefined : name => createOption(run, db, property, name)} />}
  </>
}

/** Puts `text` into the editor that is opening, as typed, replacing what was there (a few frames for it to mount). */
/** What he's typed on a cell before its editor is up: it all goes in, replacing the value, however fast he types. */
let typedAhead = ''
function typeInto(text: string) {
  const waiting = typedAhead !== ''
  typedAhead += text
  if (waiting) return
  const field = () => document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.property-popover input, .property-popover textarea, .property-sheet input, .property-sheet textarea')
  const place = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const typed = typedAhead
    typedAhead = ''
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, typed)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.setSelectionRange?.(typed.length, typed.length)
  }
  const now = field()
  if (now) { place(now); return }
  // Placed as soon as the field exists, before the next key can land in it.
  const observer = new MutationObserver(() => { const input = field(); if (input) { stop(); place(input) } })
  const giveUp = setTimeout(() => { stop(); typedAhead = '' }, 2000)
  const stop = () => { observer.disconnect(); clearTimeout(giveUp) }
  observer.observe(document.body, { childList: true, subtree: true })
}

/** Column widths until he drags one (stored on the view), design §4.1. Name's width is in CSS: 240, or 150 on the phone. */
/** The `+` column's share of a table's width; it takes whatever's left over past that. */
const addColumnWidth = 40
function defaultWidth(property: Property): number {
  switch (property.type) {
    case 'checkbox': return 60
    case 'number': return 90
    case 'date': return 110
    case 'select': case 'multiSelect': case 'status': return 140
    case 'relation': return 180
    case 'rollup': return 120
    case 'text': case 'url': case 'email': case 'phone': return 180
    case 'createdTime': case 'editedTime': return 150
    case 'id': return 70 + (property.prefix?.length ?? 0) * 8
  }
}
/** "Property", "Property 2", …: never a name the database already has (or "Name"). */
function uniqueName(db: Database): string {
  const taken = new Set(['name', ...db.properties.map(p => p.name.toLocaleLowerCase())])
  for (let n = 1; ; n++) { const name = n === 1 ? 'Property' : `Property ${n}`; if (!taken.has(name.toLocaleLowerCase())) return name }
}

/** The full page of a database (design §4.3): the page's own title above, the table, no body. */
export function DatabasePage({ workspace, db }: { workspace: Workspace; db: Page & { database: Database } }) {
  return <div className="database-block is-page"><DatabaseView workspace={workspace} db={db} blockId={`page:${db.id}`} pageDate={null} cap={rowCaps.page} showTitle={false} /></div>
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
  const failedHere = [...pendingCells.values()].filter(p => p.failed && !p.part && p.databaseId === db.id)
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
        {isReadOnly(property)
          ? <span className="row-property-value is-read-only">{isEmptyValue(value) ? <span className="is-placeholder">Empty</span> : <PropertyCell property={property} value={value} today={today} />}</span>
          : property.type === 'checkbox'
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
function RulesLine({ db, view, blockId, databaseId, onChange }: { db: Database; view: View; blockId: string; databaseId: string; onChange: (build: (current: View) => { filter?: Condition[]; sort?: View['sort'] }) => void }) {
  return <div className="database-filter-line">
    {view.filter.map((c, i) => {
      const property = propertyOf(db, c.by)
      return <Fragment key={`f${i}`}>{view.filterAny && i > 0 && <span className="database-filter-or">or</span>}<span className={`database-filter-chip ${property ? '' : 'is-deleted'}`}>
        <button type="button" className="database-chip-open" onClick={() => openDatabaseMenu(blockId, databaseId, 'filter')}>{property ? property.name : '(deleted)'} {filterWords(c, property)}</button>
        <button type="button" className="database-chip-remove" aria-label="Remove filter" onClick={() => onChange(current => ({ filter: current.filter.filter((_, j) => j !== i) }))}>×</button>
      </span></Fragment>
    })}
    {view.sort.map((s, i) => {
      const property = propertyOf(db, s.by)
      if (!property) return null
      return <span key={`s${i}`} className="database-filter-chip is-sort">
        <button type="button" className="database-chip-open" onClick={() => openDatabaseMenu(blockId, databaseId, 'sort')}>{property.name} {s.direction === 'asc' ? '↑' : '↓'}</button>
        <button type="button" className="database-chip-remove" aria-label="Remove sort" onClick={() => onChange(current => ({ sort: current.sort.filter((_, j) => j !== i) }))}>×</button>
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
    : property?.type === 'id' ? `${property.prefix ?? ''}${String(v)}`
    : String(v)
  // A rule still waiting for its value reads as unfinished, not broken (Jazz 72ba456b).
  return `${op} ${text || '…'}`
}
