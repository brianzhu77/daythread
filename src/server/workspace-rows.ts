// The workspace as rows (shot 2): what the Postgres store reads and writes. Pure: no SQL here. A loaded workspace is
// its rows with their positions; a command's result is turned back into rows, and the difference is what gets written,
// with the rows as they were as the operation's inverse (what Undo puts back). The domain never sees positions.
import { expandedWorkspace, storedDocument, type SyncedRecord } from '../domain/synced.ts'
import type { CommentThread, CommentAnchor } from '../domain/comments.ts'
import type { Automation } from '../domain/automations.ts'
import { linkId, type TaskLink } from '../domain/task-links.ts'
import type { Page, Task, Workspace, WeekStart } from '../domain/types.ts'

export interface PageRow {
  id: string; position: number; type: Page['type']; date: string | null; title: string; url: string | null; parent_id: string | null
  trashed_at: string | null; trash_id: string | null; document: string; handoff_done: boolean; review_saved: boolean
  /** Databases (JSON text, like `document`): a database page's schema and views; a row's values (`values` is an SQL keyword). */
  database_json: string | null; row_values: string | null; created_at: string | null; edited_at: string | null; icon: string | null; cover: string | null; cover_position: string | null
}
export interface TaskRow {
  id: string; position: number; title: string; status: Task['status']; version: number; paused: boolean; deadline_on: string | null
  attention_on: string | null; created_on: string; source_page_id: string; done_on: string | null
}
/** A tombstone, kept as the task's exact JSON. */
export interface DeletedRow { id: string; position: number; data: string }
/** A thread of comments: its own table, which no save of a page touches and an older build never reads. */
export interface ThreadRow { id: string; page_id: string; version: number; created_at: string; resolved_at: string | null; comments: string; /** Absent in a row from before anchors. */ anchor?: string | null }

/** A to-do blocked by another: its own table, keyed on both tasks, which an older build never reads, so its saves and deletes leave it alone (todo-dependency.md §4). */
export interface LinkRow { id: string; blocked_id: string; blocker_id: string; created_at: string }

export interface Rows { revision: number; timezone: string; /** Absent or 0: Sunday. */ weekStart?: WeekStart; /** To-dos' rules as JSON, on the workspace's row, which an older build never writes; null with none. */ todoAutomations?: string | null; pages: PageRow[]; tasks: TaskRow[]; deleted: DeletedRow[]; threads: ThreadRow[]; /** Absent from a store before links. */ links?: LinkRow[] }
export interface RowSet<R extends { id: string }> { upsert: R[]; remove: string[] }
/** What a save writes, or what an Undo puts back: rows whole, by id, plus the time zone when it changed. */
export interface RowDiff { timezone?: string; weekStart?: WeekStart; /** When they changed; absent in an older build's inverse, which then leaves them. */ todoAutomations?: string | null; pages: RowSet<PageRow>; tasks: RowSet<TaskRow>; deleted: RowSet<DeletedRow>; /** Absent in an inverse written by a build before comments. */ threads?: RowSet<ThreadRow>; /** Absent in one written before links, which then leaves them as they are. */ links?: RowSet<LinkRow> }

/** A text column refuses U+0000; the domain drops it on the way in, and rows written from older data drop it here. */
const clean = (s: string): string => s.includes('\u0000') ? s.replace(/\u0000/g, '') : s
export const pageRow = (p: Page, position: number): PageRow => ({
  id: p.id, position, type: p.type, date: p.date ?? null, title: clean(p.title), url: p.url ?? null, parent_id: p.parentId ?? null,
  trashed_at: p.trashedAt ?? null, trash_id: p.trashId ?? null, document: storedDocument(p.document), handoff_done: Boolean(p.handoffDone), review_saved: Boolean(p.reviewSaved),
  database_json: p.database ? JSON.stringify(p.database) : null, row_values: p.values ? JSON.stringify(p.values) : null, created_at: p.createdAt ?? null, edited_at: p.editedAt ?? null, icon: p.icon ?? null, cover: p.cover ?? null, cover_position: p.coverPosition !== undefined ? String(p.coverPosition) : null,
})
/** The canonical page: optional facts present only when set, as the domain and the converter write them. */
export const pageOf = (r: PageRow): Page => ({
  id: r.id, type: r.type, date: r.date, title: r.title,
  ...(r.url !== null ? { url: r.url } : {}), ...(r.parent_id !== null ? { parentId: r.parent_id } : {}),
  ...(r.trashed_at !== null ? { trashedAt: r.trashed_at, trashId: r.trash_id } : {}),
  document: r.document, ...(r.handoff_done ? { handoffDone: true } : {}), ...(r.review_saved ? { reviewSaved: true } : {}),
  // A row written before these columns existed reads them as null (`?? null`): the fields are simply absent.
  ...(r.database_json != null ? { database: JSON.parse(r.database_json) } : {}), ...(r.row_values != null ? { values: JSON.parse(r.row_values) } : {}),
  ...(r.created_at != null ? { createdAt: r.created_at } : {}), ...(r.edited_at != null ? { editedAt: r.edited_at } : {}), ...(r.icon != null ? { icon: r.icon } : {}),
  ...(r.cover != null ? { cover: r.cover } : {}), ...(r.cover_position != null ? { coverPosition: Number(r.cover_position) } : {}),
})
export const taskRow = (t: Task, position: number): TaskRow => ({
  id: t.id, position, title: clean(t.title), status: t.status, version: t.version, paused: t.paused, deadline_on: t.deadlineOn ?? null,
  attention_on: t.attentionOn ?? null, created_on: t.createdOn, source_page_id: t.sourcePageId, done_on: t.doneOn ?? null,
})
export const taskOf = (r: TaskRow): Task => ({
  id: r.id, title: r.title, status: r.status, version: r.version, paused: r.paused, deadlineOn: r.deadline_on, attentionOn: r.attention_on,
  createdOn: r.created_on, sourcePageId: r.source_page_id, ...(r.done_on !== null ? { doneOn: r.done_on } : {}),
})
const deletedRow = (t: Task, position: number): DeletedRow => ({ id: t.id, position, data: JSON.stringify(t) })

const byPosition = <R extends { position: number }>(rows: R[]): R[] => [...rows].sort((a, b) => a.position - b.position)

/** The workspace the domain works on, from its rows: receipts and the Undo marker are the store's to add. */
// In the table's order: rows are compared by their JSON, so a thread that hasn't changed must read as it does coming back.
const threadRow = (t: CommentThread): ThreadRow => ({ id: t.id, page_id: t.pageId, version: t.version, created_at: t.createdAt, resolved_at: t.resolvedAt ?? null, comments: JSON.stringify(t.comments), anchor: t.anchor ? JSON.stringify(t.anchor) : null })
const threadOf = (r: ThreadRow): CommentThread => ({ ...(r.anchor ? { anchor: JSON.parse(r.anchor) as CommentAnchor } : {}), id: r.id, pageId: r.page_id, version: r.version, createdAt: r.created_at, ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}), comments: JSON.parse(r.comments) as CommentThread['comments'] })
const rulesJson = (ws: Pick<Workspace, 'todoAutomations'>): string | null => (ws.todoAutomations?.length ? JSON.stringify(ws.todoAutomations) : null)
/**
 * To-dos' rules as stored, or null if what's stored can't be read: then the workspace loads with none rather than not at all, says so once
 * in the log, and the value is left as it is until a rule is made, so nothing that might be mended is written over (Lead).
 */
function readRules(stored: string | null | undefined): Automation[] | null {
  if (!stored) return null
  try {
    const rules = JSON.parse(stored) as unknown
    if (Array.isArray(rules)) return rules as Automation[]
  } catch { /* below */ }
  if (!unreadable.has(stored)) { unreadable.add(stored); console.warn(JSON.stringify({ level: 'warn', event: 'rules.unreadable', bytes: stored.length })) }
  return null
}
const unreadable = new Set<string>()
const readableRules = (stored: string | null | undefined): boolean => !stored || readRules(stored) !== null
const linkRow = (l: TaskLink): LinkRow => ({ id: linkId(l), blocked_id: l.blockedId, blocker_id: l.blockerId, created_at: l.createdAt })
const linkOf = (r: LinkRow): TaskLink => ({ blockedId: r.blocked_id, blockerId: r.blocker_id, createdAt: r.created_at })
export function workspaceOf(rows: Rows): Workspace {
  const sorted = byPosition(rows.pages), synced = sorted.filter(r => r.type === 'synced').map(recordOf)
  return expandedWorkspace({
    schemaVersion: 2, revision: rows.revision, timezone: rows.timezone, ...(rows.weekStart === 1 ? { weekStart: 1 as const } : {}),
    ...(() => { const rules = readRules(rows.todoAutomations); return rules?.length ? { todoAutomations: rules } : {} })(),
    ...(synced.length ? { synced } : {}),
    pages: sorted.filter(r => r.type !== 'synced').map(pageOf), tasks: byPosition(rows.tasks).map(taskOf),
    deletedTasks: byPosition(rows.deleted).map(r => JSON.parse(r.data) as Task), receipts: {},
    ...(rows.threads.length ? { threads: [...rows.threads].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(threadOf) } : {}),
    ...(rows.links?.length ? { links: [...rows.links].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(linkOf) } : {}),
  })
}

/** A synced block's lines take a page row, hidden from the domain: its one row is all an edit writes. */
const recordRow = (r: SyncedRecord, position: number): PageRow => ({
  id: `synced:${r.id}`, position, type: 'synced', date: null, title: '', url: null, parent_id: null, trashed_at: null, trash_id: null, document: r.lines,
  handoff_done: false, review_saved: false, database_json: null, row_values: JSON.stringify({ rev: r.rev, original: r.original }), created_at: null, edited_at: null, icon: null, cover: null, cover_position: null,
})
function recordOf(row: PageRow): SyncedRecord {
  const { rev, original } = JSON.parse(row.row_values ?? '{}') as { rev: number; original: string }
  return { id: row.id.slice('synced:'.length), lines: row.document, rev, original }
}
/** The pages' rows and the records', in that order: each record's row sits after every page. */
const pageEntities = (ws: Workspace): { id: string; row(position: number): PageRow }[] => [
  ...ws.pages.map(p => ({ id: p.id, row: (position: number) => pageRow(p, position) })),
  ...(ws.synced ?? []).map(r => ({ id: `synced:${r.id}`, row: (position: number) => recordRow(r, position) })),
]

/** Rows for a workspace with no history (a migration, a first import): positions are the indexes. */
export function rowsOf(ws: Workspace): Rows {
  return {
    revision: ws.revision, timezone: ws.timezone, weekStart: ws.weekStart ?? 0, todoAutomations: rulesJson(ws),
    pages: pageEntities(ws).map((e, i) => e.row(i)), tasks: ws.tasks.map((t, i) => taskRow(t, i)), deleted: ws.deletedTasks.map((t, i) => deletedRow(t, i)),
    threads: (ws.threads ?? []).map(threadRow), links: (ws.links ?? []).map(linkRow),
  }
}

/**
 * Positions for the new order: a row keeps its position while the order allows, a row that is new or out of place
 * gets one between its neighbours, so an append or a removal rewrites only the rows involved. When two neighbours
 * leave no room, every row is renumbered.
 */
export function positionsFor(ids: string[], previous: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  let last = -1
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!, kept = previous.get(id)
    if (kept !== undefined && kept > last) { out.set(id, kept); last = kept; continue }
    // The next row that keeps its position bounds the new one from above.
    let next: number | undefined
    for (let j = i + 1; j < ids.length && next === undefined; j++) { const q = previous.get(ids[j]!); if (q !== undefined && q > last) next = q }
    const position = next === undefined ? Math.floor(last) + 1 : (last + next) / 2
    if (position <= last || (next !== undefined && position >= next)) return new Map(ids.map((x, k) => [x, k]))
    out.set(id, position); last = position
  }
  return out
}

function diffSet<R extends { id: string }>(before: R[], after: R[]): { write: RowSet<R>; inverse: RowSet<R> } {
  const was = new Map(before.map(r => [r.id, r])), is = new Map(after.map(r => [r.id, r]))
  const write: RowSet<R> = { upsert: [], remove: [] }, inverse: RowSet<R> = { upsert: [], remove: [] }
  for (const r of after) {
    const old = was.get(r.id)
    if (!old) { write.upsert.push(r); inverse.remove.push(r.id) }
    else if (JSON.stringify(old) !== JSON.stringify(r)) { write.upsert.push(r); inverse.upsert.push(old) }
  }
  for (const r of before) if (!is.has(r.id)) { write.remove.push(r.id); inverse.upsert.push(r) }
  return { write, inverse }
}

/** What a command changed, as rows to write and the rows to put back. */
export function planWrites(before: Rows, after: Workspace): { write: RowDiff; inverse: RowDiff; rows: Rows } {
  const positions = <E extends { id: string }, R extends { id: string; position: number }>(entities: E[], previous: R[], row: (e: E, position: number) => R): R[] => {
    const next = positionsFor(entities.map(e => e.id), new Map(previous.map(r => [r.id, r.position])))
    return entities.map(e => row(e, next.get(e.id)!))
  }
  const rows: Rows = {
    revision: after.revision, timezone: after.timezone, weekStart: after.weekStart ?? 0, todoAutomations: readableRules(before.todoAutomations) || rulesJson(after) !== null ? rulesJson(after) : before.todoAutomations ?? null,
    pages: positions(pageEntities(after), before.pages, (e, position) => e.row(position)), tasks: positions(after.tasks, before.tasks, taskRow), deleted: positions(after.deletedTasks, before.deleted, deletedRow), threads: (after.threads ?? []).map(threadRow), links: (after.links ?? []).map(linkRow),
  }
  const pages = diffSet(before.pages, rows.pages), tasks = diffSet(before.tasks, rows.tasks), deleted = diffSet(before.deleted, rows.deleted), threads = diffSet(before.threads, rows.threads), links = diffSet(before.links ?? [], rows.links ?? [])
  const timezone = before.timezone !== after.timezone
  const weekStart = (before.weekStart ?? 0) !== (after.weekStart ?? 0)
  // An unreadable value is only replaced once he makes a rule; until then it's kept as it was.
  const rules = readableRules(before.todoAutomations) ? (before.todoAutomations ?? null) !== rulesJson(after) : rulesJson(after) !== null
  return {
    write: { ...(timezone ? { timezone: after.timezone } : {}), ...(weekStart ? { weekStart: after.weekStart ?? 0 } : {}), ...(rules ? { todoAutomations: rulesJson(after) } : {}), pages: pages.write, tasks: tasks.write, deleted: deleted.write, threads: threads.write, links: links.write },
    inverse: { ...(timezone ? { timezone: before.timezone } : {}), ...(weekStart ? { weekStart: before.weekStart ?? 0 } : {}), ...(rules ? { todoAutomations: before.todoAutomations ?? null } : {}), pages: pages.inverse, tasks: tasks.inverse, deleted: deleted.inverse, threads: threads.inverse, links: links.inverse },
    rows,
  }
}

function applySet<R extends { id: string }>(rows: R[], set: RowSet<R>): R[] {
  const gone = new Set(set.remove), replaced = new Map(set.upsert.map(r => [r.id, r]))
  const kept = rows.filter(r => !gone.has(r.id) && !replaced.has(r.id))
  return [...kept, ...set.upsert]
}
/** The rows as they were before the operation whose inverse this is. */
export function applyDiff(rows: Rows, diff: RowDiff): Rows {
  return {
    revision: rows.revision, timezone: diff.timezone ?? rows.timezone, weekStart: diff.weekStart ?? rows.weekStart ?? 0, todoAutomations: diff.todoAutomations !== undefined ? diff.todoAutomations : rows.todoAutomations ?? null,
    pages: applySet(rows.pages, diff.pages), tasks: applySet(rows.tasks, diff.tasks), deleted: applySet(rows.deleted, diff.deleted), threads: diff.threads ? applySet(rows.threads, { ...diff.threads, upsert: diff.threads.upsert.map((t) => (t.anchor !== undefined ? t : { ...t, anchor: rows.threads.find((held) => held.id === t.id)?.anchor ?? null })) }) : rows.threads,
    links: diff.links ? applySet(rows.links ?? [], diff.links) : rows.links ?? []
  }
}
