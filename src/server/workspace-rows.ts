// The workspace as rows (shot 2): what the Postgres store reads and writes. Pure: no SQL here. A loaded workspace is
// its rows with their positions; a command's result is turned back into rows, and the difference is what gets written,
// with the rows as they were as the operation's inverse (what Undo puts back). The domain never sees positions.
import type { Page, Task, Workspace } from '../domain/types.ts'

export interface PageRow {
  id: string; position: number; type: Page['type']; date: string | null; title: string; url: string | null; parent_id: string | null
  trashed_at: string | null; trash_id: string | null; document: string; handoff_done: boolean; review_saved: boolean
  /** Databases (JSON text, like `document`): a database page's schema and views; a row's values (`values` is an SQL keyword). */
  database_json: string | null; row_values: string | null; created_at: string | null; edited_at: string | null
}
export interface TaskRow {
  id: string; position: number; title: string; status: Task['status']; version: number; paused: boolean; deadline_on: string | null
  attention_on: string | null; created_on: string; source_page_id: string; done_on: string | null
}
/** A tombstone, kept as the task's exact JSON. */
export interface DeletedRow { id: string; position: number; data: string }

export interface Rows { revision: number; timezone: string; pages: PageRow[]; tasks: TaskRow[]; deleted: DeletedRow[] }
export interface RowSet<R extends { id: string }> { upsert: R[]; remove: string[] }
/** What a save writes, or what an Undo puts back: rows whole, by id, plus the time zone when it changed. */
export interface RowDiff { timezone?: string; pages: RowSet<PageRow>; tasks: RowSet<TaskRow>; deleted: RowSet<DeletedRow> }

/** A text column refuses U+0000; the domain drops it on the way in, and rows written from older data drop it here. */
const clean = (s: string): string => s.includes('\u0000') ? s.replace(/\u0000/g, '') : s
export const pageRow = (p: Page, position: number): PageRow => ({
  id: p.id, position, type: p.type, date: p.date ?? null, title: clean(p.title), url: p.url ?? null, parent_id: p.parentId ?? null,
  trashed_at: p.trashedAt ?? null, trash_id: p.trashId ?? null, document: p.document, handoff_done: Boolean(p.handoffDone), review_saved: Boolean(p.reviewSaved),
  database_json: p.database ? JSON.stringify(p.database) : null, row_values: p.values ? JSON.stringify(p.values) : null, created_at: p.createdAt ?? null, edited_at: p.editedAt ?? null,
})
/** The canonical page: optional facts present only when set, as the domain and the converter write them. */
export const pageOf = (r: PageRow): Page => ({
  id: r.id, type: r.type, date: r.date, title: r.title,
  ...(r.url !== null ? { url: r.url } : {}), ...(r.parent_id !== null ? { parentId: r.parent_id } : {}),
  ...(r.trashed_at !== null ? { trashedAt: r.trashed_at, trashId: r.trash_id } : {}),
  document: r.document, ...(r.handoff_done ? { handoffDone: true } : {}), ...(r.review_saved ? { reviewSaved: true } : {}),
  // A row written before these columns existed reads them as null (`?? null`): the fields are simply absent.
  ...(r.database_json != null ? { database: JSON.parse(r.database_json) } : {}), ...(r.row_values != null ? { values: JSON.parse(r.row_values) } : {}),
  ...(r.created_at != null ? { createdAt: r.created_at } : {}), ...(r.edited_at != null ? { editedAt: r.edited_at } : {}),
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
export function workspaceOf(rows: Rows): Workspace {
  return {
    schemaVersion: 2, revision: rows.revision, timezone: rows.timezone,
    pages: byPosition(rows.pages).map(pageOf), tasks: byPosition(rows.tasks).map(taskOf),
    deletedTasks: byPosition(rows.deleted).map(r => JSON.parse(r.data) as Task), receipts: {},
  }
}

/** Rows for a workspace with no history (a migration, a first import): positions are the indexes. */
export function rowsOf(ws: Workspace): Rows {
  return {
    revision: ws.revision, timezone: ws.timezone,
    pages: ws.pages.map((p, i) => pageRow(p, i)), tasks: ws.tasks.map((t, i) => taskRow(t, i)), deleted: ws.deletedTasks.map((t, i) => deletedRow(t, i)),
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
    revision: after.revision, timezone: after.timezone,
    pages: positions(after.pages, before.pages, pageRow), tasks: positions(after.tasks, before.tasks, taskRow), deleted: positions(after.deletedTasks, before.deleted, deletedRow),
  }
  const pages = diffSet(before.pages, rows.pages), tasks = diffSet(before.tasks, rows.tasks), deleted = diffSet(before.deleted, rows.deleted)
  const timezone = before.timezone !== after.timezone
  return {
    write: { ...(timezone ? { timezone: after.timezone } : {}), pages: pages.write, tasks: tasks.write, deleted: deleted.write },
    inverse: { ...(timezone ? { timezone: before.timezone } : {}), pages: pages.inverse, tasks: tasks.inverse, deleted: deleted.inverse },
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
    revision: rows.revision, timezone: diff.timezone ?? rows.timezone,
    pages: applySet(rows.pages, diff.pages), tasks: applySet(rows.tasks, diff.tasks), deleted: applySet(rows.deleted, diff.deleted),
  }
}
