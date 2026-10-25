// B27 rollback (Lead dee40862): a build from before B27 can't open a page whose document holds a `dateMention` (BlockNote
// refuses the unknown inline type). This turns every chip into its stored text form (`@Nov 20 3pm`, the same text the
// line's stored text already has) on every page, trashed ones included, so the previous build opens every page with
// his words intact; and it clears Undo, which could bring a chip back (Lead df8b4a85, as the page-link rollback did).
// Nothing else changes: same revision, same blocks, same ids. Running it again changes nothing.
import type { DatabaseSync } from 'node:sqlite'
import { mentionText, validDate, validTime } from '../domain/date-chip.ts'
import type { Page, Workspace } from '../domain/types.ts'
import type { SqlClient } from './db/sql.ts'

/** A chip as plain text; a malformed one keeps whatever date it holds, so nothing he wrote disappears. */
function chipText(props: Record<string, unknown> | undefined, pageDate: string | null): string {
  const date = props?.date, time = props?.time
  if (validDate(date)) return mentionText({ date, time: validTime(time) ? time : null }, pageDate)
  return typeof date === 'string' && date ? `@${date}` : ''
}
/** The inline content with every chip as text; `count.n` goes up per chip. */
function contentAsText(content: unknown, pageDate: string | null, count: { n: number }): unknown {
  if (!Array.isArray(content)) return content
  return content.map(item => {
    if (!item || typeof item !== 'object') return item
    const c = item as { type?: string; props?: Record<string, unknown>; content?: unknown }
    if (c.type === 'dateMention') { count.n++; return { type: 'text', text: chipText(c.props, pageDate), styles: {} } }
    return 'content' in c ? { ...c, content: contentAsText(c.content, pageDate, count) } : c
  })
}
type Node = { content?: unknown; children?: Node[] }
const nodesAsText = (nodes: Node[], pageDate: string | null, count: { n: number }): Node[] =>
  nodes.map(n => ({ ...n, ...(n.content !== undefined ? { content: contentAsText(n.content, pageDate, count) } : {}), ...(Array.isArray(n.children) ? { children: nodesAsText(n.children, pageDate, count) } : {}) }))

/** One stored editor document (a JSON string) with its chips as text; unchanged (same string) when it has none. */
export function documentAsText(json: string | null | undefined, pageDate: string | null): { json: string | null | undefined; chips: number } {
  if (!json || !json.includes('"dateMention"')) return { json, chips: 0 }
  let nodes: unknown
  try { nodes = JSON.parse(json) } catch { return { json, chips: 0 } }
  if (!Array.isArray(nodes)) return { json, chips: 0 }
  const count = { n: 0 }
  const next = nodesAsText(nodes as Node[], pageDate, count)
  return count.n ? { json: JSON.stringify(next), chips: count.n } : { json, chips: 0 }
}
const textDateOf = (page: Pick<Page, 'type' | 'date'>) => page.type === 'daily' ? page.date ?? null : null

/** Every place a page keeps an editor document: the document itself and a pasted link's preview record. */
function pageAsText(page: Page): number {
  let chips = 0
  const date = textDateOf(page)
  const doc = documentAsText(page.editorJSON, date)
  if (doc.chips) { page.editorJSON = doc.json ?? undefined; chips += doc.chips }
  for (const entry of Object.values(page.editorBlockMetadata ?? {})) {
    const preview = entry.linkPaste?.preview
    if (!preview?.document) continue
    const p = documentAsText(preview.document, date)
    if (p.chips) { preview.document = p.json!; chips += p.chips }
  }
  return chips
}

/** In place: every chip on every page becomes text, and Undo is cleared. */
export function chipsAsText(ws: Workspace): { chips: number; undoCleared: boolean } {
  let chips = 0
  for (const page of ws.pages) chips += pageAsText(page)
  const undoCleared = ws.undo !== undefined
  delete ws.undo
  return { chips, undoCleared }
}

const entityTables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts']
/** SQLite: the current `pages` rows, then Undo cleared, in the caller's transaction. `dryRun` only counts. */
export function chipsAsTextSqlite(db: DatabaseSync, dryRun = false): { chips: number; undoCleared: boolean } {
  const rows = db.prepare("SELECT snapshot, id, type, date, editorJSON, editorBlockMetadata FROM pages WHERE snapshot = 'current' AND (editorJSON LIKE '%dateMention%' OR editorBlockMetadata LIKE '%dateMention%')").all()
  const update = db.prepare('UPDATE pages SET editorJSON = ?, editorBlockMetadata = ? WHERE snapshot = ? AND id = ?')
  const undoCleared = Boolean(db.prepare("SELECT 1 FROM meta WHERE snapshot = 'undo'").get()) || db.prepare("SELECT undoOperationId FROM meta WHERE snapshot = 'current'").get()?.undoOperationId != null
  let chips = 0
  for (const row of rows) {
    const page = { type: String(row.type), date: row.date === null ? undefined : String(row.date), editorJSON: row.editorJSON === null ? undefined : String(row.editorJSON),
      editorBlockMetadata: row.editorBlockMetadata === null ? undefined : JSON.parse(String(row.editorBlockMetadata)) } as Page
    const n = pageAsText(page)
    if (!n) continue
    if (!dryRun) update.run(page.editorJSON ?? null, page.editorBlockMetadata === undefined ? null : JSON.stringify(page.editorBlockMetadata), String(row.snapshot), String(row.id))
    chips += n
  }
  if (!dryRun && undoCleared) {
    for (const table of entityTables) db.prepare(`DELETE FROM ${table} WHERE snapshot = 'undo'`).run()
    db.prepare("DELETE FROM meta WHERE snapshot = 'undo'").run()
    db.prepare("UPDATE meta SET undoOperationId = NULL, undoRevision = NULL WHERE snapshot = 'current'").run()
  }
  return { chips, undoCleared }
}

/**
 * Postgres: the one workspace row, locked and rewritten in one transaction. `keep` gets the row's document as it was,
 * under the lock and before anything is written (the backup); if it throws, nothing changes.
 */
export async function chipsAsTextPostgres(sql: SqlClient, table: string, keep: (data: string, revision: number) => void = () => {}): Promise<{ chips: number; undoCleared: boolean; revision: number }> {
  return sql.transaction(async tx => {
    const [row] = await tx.query<{ data: string; revision: number }>(`select data::text as data, revision from ${table} where id = 1 for update`)
    if (!row) throw new Error('Workspace missing; nothing changed')
    keep(row.data, row.revision)
    const ws = JSON.parse(row.data) as Workspace
    const { chips, undoCleared } = chipsAsText(ws)
    if (chips || undoCleared) await tx.query(`update ${table} set data = $1::text::json, updated_at = now() where id = 1`, [JSON.stringify(ws)])
    return { chips, undoCleared, revision: row.revision }
  })
}
