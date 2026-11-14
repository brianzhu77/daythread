// What a command changed, as the browser needs it: the pages and tasks that differ, by id, instead of the whole
// workspace (docs/research/database-fit.md §5: every response carried all of it, ~0.85 MB per 1,000 pages). Pure, shared
// by the server, which makes it, and the browser, which applies it to the copy the command was sent from.
import type { SmartNote } from './smart-note.ts'
import { expandedWorkspace, strippedWorkspace, type SyncedRecord } from './synced.ts'
import type { CommentThread } from './comments.ts'
import type { Automation } from './automations.ts'
import type { TaskLink } from './task-links.ts'
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
  /** Absent: Sunday. */
  weekStart?: 1
  /** To-dos' stored rules couldn't be read (workspace-rows.ts). */
  todoAutomationsUnreadable?: true
  undo: { operationId: string; revision: number } | null
  pages: ListChanges<Page>
  tasks: ListChanges<Task>
  /** The tombstones whole when they changed (at most `tombstoneLimit`); absent when unchanged. */
  deletedTasks?: Task[]
  /** Synced blocks' records, whole, when any changed. Pages travel without their lines: the browser expands them from these. */
  synced?: SyncedRecord[]
  smartNotes?: SmartNote[]
  /** Comments, whole, when any changed. A person's notes stay small, and a tab that doesn't know them ignores this. */
  threads?: CommentThread[]
  /** To-dos' rules, whole, when they changed; null when the last went. */
  todoAutomations?: Automation[] | null
  /** Links between to-dos, whole, when any changed. */
  links?: TaskLink[]
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
  const synced = JSON.stringify(before.synced ?? []) === JSON.stringify(after.synced ?? []) ? {} : { synced: after.synced ?? [] }
  const smartNotes = JSON.stringify(before.smartNotes ?? []) === JSON.stringify(after.smartNotes ?? []) ? {} : { smartNotes: after.smartNotes ?? [] }
  const threads = JSON.stringify(before.threads ?? []) === JSON.stringify(after.threads ?? []) ? {} : { threads: after.threads ?? [] }
  const rules = JSON.stringify(before.todoAutomations ?? []) === JSON.stringify(after.todoAutomations ?? []) ? {} : { todoAutomations: after.todoAutomations?.length ? after.todoAutomations : null }
  const links = JSON.stringify(before.links ?? []) === JSON.stringify(after.links ?? []) ? {} : { links: after.links ?? [] }
  return {
    from: before.revision, revision: after.revision, timezone: after.timezone, ...(after.weekStart === 1 ? { weekStart: 1 as const } : {}), ...(after.todoAutomationsUnreadable ? { todoAutomationsUnreadable: true as const } : {}), undo: undoMarker(after),
    pages: listChanges(strippedWorkspace(before).pages, strippedWorkspace(after).pages), tasks: listChanges(before.tasks, after.tasks), ...deleted, ...synced, ...smartNotes, ...threads, ...links, ...rules,
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
  const synced = changes.synced ?? ws.synced, smartNotes = changes.smartNotes ?? ws.smartNotes, threads = changes.threads ?? ws.threads, links = changes.links ?? ws.links, rules = changes.todoAutomations !== undefined ? changes.todoAutomations : ws.todoAutomations
  if (!pages || !tasks) return null
  const { undo: _undo, smartNotes: _smartNotes, weekStart: _weekStart, threads: _threads, links: _links, todoAutomations: _rules, todoAutomationsUnreadable: _unread, ...rest } = ws
  return expandedWorkspace({
    ...rest, revision: changes.revision, timezone: changes.timezone, ...(changes.weekStart === 1 ? { weekStart: 1 as const } : {}), ...(changes.todoAutomationsUnreadable ? { todoAutomationsUnreadable: true as const } : {}), pages, tasks,
    deletedTasks: changes.deletedTasks ?? ws.deletedTasks, receipts: {},
    ...(synced ? { synced } : {}),
    ...(smartNotes?.length ? { smartNotes } : {}),
    ...(threads?.length ? { threads } : {}),
    ...(links?.length ? { links } : {}),
    ...(rules?.length ? { todoAutomations: rules } : {}),
    ...(changes.undo ? { undo: changes.undo } : {}),
  })
}
