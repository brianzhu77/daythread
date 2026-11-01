// What a command changed, as the browser needs it: the pages and tasks that differ, by id, instead of the whole
// workspace (docs/research/database-fit.md §5: every response carried all of it, ~0.85 MB per 1,000 pages). Pure, shared
// by the server, which makes it, and the browser, which applies it to the copy the command was sent from.
import type { Page, Task, Workspace } from './types.ts'

export interface ListChanges<T> {
  upsert: T[]
  remove: string[]
  /** Every id in the new order; only when applying `upsert`/`remove` in place wouldn't give that order. */
  order?: string[]
}
export interface WorkspaceChanges {
  /** The revision the changes apply to; a copy at any other revision must be loaded again instead. */
  from: number
  revision: number
  timezone: string
  undo: { operationId: string; revision: number } | null
  pages: ListChanges<Page>
  tasks: ListChanges<Task>
  /** The tombstones whole when they changed (at most `tombstoneLimit`); absent when unchanged. */
  deletedTasks?: Task[]
}

/** Existing entries replaced where they are, removed ones dropped, new ones appended in the new list's order. */
function merged<T extends { id: string }>(before: readonly T[], changes: ListChanges<T>): T[] {
  const gone = new Set(changes.remove), replaced = new Map(changes.upsert.map(e => [e.id, e]))
  const out = before.filter(e => !gone.has(e.id)).map(e => replaced.get(e.id) ?? e)
  const present = new Set(out.map(e => e.id))
  for (const e of changes.upsert) if (!present.has(e.id)) out.push(e)
  return out
}
const sameIds = (a: readonly { id: string }[], b: readonly string[]): boolean => a.length === b.length && a.every((e, i) => e.id === b[i])

function listChanges<T extends { id: string }>(before: readonly T[], after: readonly T[]): ListChanges<T> {
  const was = new Map(before.map(e => [e.id, JSON.stringify(e)]))
  const is = new Set(after.map(e => e.id))
  const changes: ListChanges<T> = { upsert: after.filter(e => was.get(e.id) !== JSON.stringify(e)), remove: before.filter(e => !is.has(e.id)).map(e => e.id) }
  const ids = after.map(e => e.id)
  if (!sameIds(merged(before, changes), ids)) changes.order = ids
  return changes
}

const undoMarker = (ws: Workspace): WorkspaceChanges['undo'] => (ws.undo ? { operationId: ws.undo.operationId, revision: ws.undo.revision } : null)

export function changesBetween(before: Workspace, after: Workspace): WorkspaceChanges {
  const deleted = JSON.stringify(before.deletedTasks) === JSON.stringify(after.deletedTasks) ? {} : { deletedTasks: after.deletedTasks }
  return {
    from: before.revision, revision: after.revision, timezone: after.timezone, undo: undoMarker(after),
    pages: listChanges(before.pages, after.pages), tasks: listChanges(before.tasks, after.tasks), ...deleted,
  }
}

function applyList<T extends { id: string }>(before: readonly T[], changes: ListChanges<T>): T[] | null {
  const out = merged(before, changes)
  if (!changes.order) return out
  const byId = new Map(out.map(e => [e.id, e]))
  if (byId.size !== changes.order.length || changes.order.some(id => !byId.has(id))) return null
  return changes.order.map(id => byId.get(id)!)
}

/** The workspace after the command, or null when `ws` isn't the copy the changes were made from (load it again). */
export function applyChanges(ws: Workspace, changes: WorkspaceChanges): Workspace | null {
  if (ws.revision !== changes.from) return null
  const pages = applyList(ws.pages, changes.pages), tasks = applyList(ws.tasks, changes.tasks)
  if (!pages || !tasks) return null
  const { undo: _undo, ...rest } = ws
  return {
    ...rest, revision: changes.revision, timezone: changes.timezone, pages, tasks,
    deletedTasks: changes.deletedTasks ?? ws.deletedTasks, receipts: {},
    ...(changes.undo ? { undo: changes.undo } : {}),
  }
}
