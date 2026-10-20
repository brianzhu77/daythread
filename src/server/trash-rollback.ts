// A4 rollback, direction A (docs/design/a4-trash-data.md §4, Lead cdbbd148): the layout-4 → 3 step the rollback script
// runs, and the step migration 4 runs when it finds what that script held back. Both run inside the caller's
// transaction, so any error leaves the database as it was.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export const heldPagesTable = 'held_trash_l4'
export const heldRefsTable = 'held_refs_l4'
const entityTables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts'] as const
const trashColumns = ['trashedAt', 'trashId']
type Row = Record<string, SQLInputValue>

const tableExists = (db: DatabaseSync, name: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
const json = <T>(value: unknown, fallback: T): T => (typeof value === 'string' && value ? JSON.parse(value) as T : fallback)
const stringify = (value: unknown) => JSON.stringify(value)
const quote = (s: string) => `"${s}"`

/** Undo restores a whole earlier workspace, so it's cleared whenever pages leave or come back outside a command. */
function clearUndo(db: DatabaseSync): void {
  for (const table of entityTables) db.prepare(`DELETE FROM ${table} WHERE snapshot='undo'`).run()
  db.prepare("DELETE FROM meta WHERE snapshot='undo'").run()
  db.prepare("UPDATE meta SET undoOperationId=NULL, undoRevision=NULL WHERE snapshot='current'").run()
}

export interface HeldSummary { held: { id: string; title: string; trashId: string }[]; refs: number }

/**
 * Layout 4 → 3, steps 3.1–3.5 of the plan. Trashed rows move to `held_trash_l4` with their full `present`, and the
 * source edges that point at them (tasks, each material source, captures) are recorded in `held_refs_l4`, so a
 * re-upgrade can tell what was written before the rollback from what was written during it.
 */
export function holdTrashForLayout3(db: DatabaseSync): HeldSummary {
  if (tableExists(db, heldPagesTable) || tableExists(db, heldRefsTable)) throw new Error('Held trash tables already exist; nothing changed')
  db.exec(`CREATE TABLE ${heldPagesTable} AS SELECT * FROM pages WHERE snapshot='current' AND "trashedAt" IS NOT NULL`)
  db.exec(`CREATE TABLE ${heldRefsTable} (kind TEXT NOT NULL CHECK(kind IN ('task','material','capture')), ownerId TEXT NOT NULL, pageId TEXT NOT NULL, blockId TEXT)`)
  const held = db.prepare(`SELECT id, title, "trashId" FROM ${heldPagesTable} ORDER BY position`).all() as { id: string; title: string; trashId: string }[]
  const ids = new Set(held.map(p => p.id))
  const record = db.prepare(`INSERT INTO ${heldRefsTable} (kind, ownerId, pageId, blockId) VALUES (?, ?, ?, ?)`)
  let refs = 0
  for (const t of db.prepare("SELECT id, sourcePageId FROM tasks WHERE snapshot='current'").all())
    if (ids.has(String(t.sourcePageId))) { record.run('task', t.id as string, t.sourcePageId as string, null); refs++ }
  for (const c of db.prepare("SELECT id, pageId FROM captures WHERE snapshot='current'").all())
    if (ids.has(String(c.pageId))) { record.run('capture', c.id as string, c.pageId as string, null); refs++ }
  for (const m of db.prepare("SELECT id, sources FROM materials WHERE snapshot='current'").all())
    for (const s of json<{ pageId: string; blockId: string }[]>(m.sources, []))
      if (ids.has(s.pageId)) { record.run('material', m.id as string, s.pageId, s.blockId); refs++ }
  db.prepare(`DELETE FROM pages WHERE snapshot='current' AND "trashedAt" IS NOT NULL`).run()
  // A page restored by the new build can still list the trash fields as present; the old build rejects unknown fields.
  for (const row of db.prepare("SELECT id, present FROM pages WHERE snapshot='current'").all()) {
    const present = json<string[]>(row.present, [])
    if (present.some(k => trashColumns.includes(k)))
      db.prepare("UPDATE pages SET present=? WHERE snapshot='current' AND id=?").run(stringify(present.filter(k => !trashColumns.includes(k))), row.id as string)
  }
  clearUndo(db)
  for (const column of trashColumns) db.exec(`ALTER TABLE pages DROP COLUMN ${quote(column)}`)
  return { held, refs }
}

function flatNodes(nodes: unknown): Record<string, unknown>[] {
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((n: Record<string, unknown>) => [n, ...flatNodes(n.children)])
}
function inlineHasContent(content: unknown): boolean {
  if (typeof content === 'string') return Boolean(content.trim())
  if (!Array.isArray(content)) return false
  return content.some((c: Record<string, unknown>) => c.type !== 'text' || Boolean(String(c.text ?? '').trim()))
}

/**
 * Lead 8e4be383: a page today's build recreated with a held id (a card's Retry) and left as it was made. In doubt,
 * it isn't empty, and both pages are kept.
 */
function isUntouchedRecreation(db: DatabaseSync, page: Row): boolean {
  const id = String(page.id)
  if (page.type !== 'document' || String(page.title ?? '').trim()) return false
  const blocks = json<{ blocks: { kind: string; text: string }[] }[]>(page.sections, []).flatMap(s => s.blocks)
  if (blocks.some(b => b.kind !== 'paragraph' || b.text.trim())) return false
  if (flatNodes(json(page.editorJSON, [])).some(n => !['paragraph', 'heading'].includes(String(n.type)) || inlineHasContent(n.content))) return false
  if (db.prepare("SELECT 1 FROM pages WHERE snapshot='current' AND parentId=?").get(id)) return false
  // Sources recorded at the rollback belong to the held page; only one written since makes the recreation "used".
  const recorded = (kind: string, ownerId: string, blockId: string | null = null) => tableExists(db, heldRefsTable) &&
    Boolean(db.prepare(`SELECT 1 FROM ${heldRefsTable} WHERE kind=? AND ownerId=? AND pageId=? AND blockId IS ?`).get(kind, ownerId, id, blockId))
  if (db.prepare("SELECT id FROM tasks WHERE snapshot='current' AND sourcePageId=?").all(id).some(t => !recorded('task', String(t.id)))) return false
  if (db.prepare("SELECT id FROM captures WHERE snapshot='current' AND pageId=?").all(id).some(c => !recorded('capture', String(c.id)))) return false
  return !db.prepare("SELECT id, sources FROM materials WHERE snapshot='current'").all()
    .some(m => json<{ pageId: string; blockId: string }[]>(m.sources, []).some(s => s.pageId === id && !recorded('material', String(m.id), s.blockId)))
}

/** Every page id a held page's own content points at (`pageLink` props, block `targetPageId` / `sourcePageId`). */
function remapIds(value: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(v => remapIds(v, map))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, (k === 'pageId' || k === 'targetPageId' || k === 'sourcePageId') && typeof v === 'string' ? map.get(v) ?? v : remapIds(v, map)]))
}
const remapJson = (value: SQLInputValue, map: Map<string, string>): SQLInputValue =>
  typeof value === 'string' && value ? stringify(remapIds(JSON.parse(value), map)) : value

export interface ReupgradeLog { restored: number; recreatedDropped: string[]; idMap: Record<string, string>; sourcesMoved: number }

/**
 * Migration 4's second half: put what the rollback held back into the trash again (plan §4, Lead 8e4be383 / cdbbd148).
 * - A held id that today's build recreated and left untouched: that page is dropped and the held page keeps its id.
 * - Otherwise both are kept: the live page keeps the id; the held page gets a new one. One map is applied to every
 *   held row's `parentId` and to page references inside held content, and only the recorded source edges that still
 *   point at the old id move. Everything in live rows stays: it was written during the rollback.
 */
export function restoreHeldTrash(db: DatabaseSync): ReupgradeLog | null {
  if (!tableExists(db, heldPagesTable)) return null
  const held = db.prepare(`SELECT * FROM ${heldPagesTable} ORDER BY position`).all() as Row[]
  const map = new Map<string, string>(), recreatedDropped: string[] = []
  for (const row of held) {
    const live = db.prepare("SELECT * FROM pages WHERE snapshot='current' AND id=?").get(row.id as string) as Row | undefined
    if (!live) continue
    if (isUntouchedRecreation(db, live)) {
      db.prepare("DELETE FROM pages WHERE snapshot='current' AND id=?").run(row.id as string)
      recreatedDropped.push(String(row.id))
    } else map.set(String(row.id), crypto.randomUUID())
  }
  let position = Number(db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pages WHERE snapshot='current'").get()!.next)
  for (const row of held) {
    const next: Row = {
      ...row,
      snapshot: 'current',
      position: position++,
      id: map.get(String(row.id)) ?? row.id,
      parentId: typeof row.parentId === 'string' ? map.get(row.parentId) ?? row.parentId : row.parentId,
      sections: remapJson(row.sections, map),
      editorJSON: remapJson(row.editorJSON, map),
      editorBlockMetadata: remapJson(row.editorBlockMetadata, map),
    }
    const names = Object.keys(next)
    db.prepare(`INSERT INTO pages (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map(n => next[n]!))
  }
  let sourcesMoved = 0
  if (tableExists(db, heldRefsTable) && map.size) {
    for (const ref of db.prepare(`SELECT * FROM ${heldRefsTable}`).all() as { kind: string; ownerId: string; pageId: string; blockId: string | null }[]) {
      const to = map.get(ref.pageId)
      if (!to) continue
      if (ref.kind === 'task') sourcesMoved += Number(db.prepare("UPDATE tasks SET sourcePageId=? WHERE snapshot='current' AND id=? AND sourcePageId=?").run(to, ref.ownerId, ref.pageId).changes)
      else if (ref.kind === 'capture') sourcesMoved += Number(db.prepare("UPDATE captures SET pageId=? WHERE snapshot='current' AND id=? AND pageId=?").run(to, ref.ownerId, ref.pageId).changes)
      else {
        const m = db.prepare("SELECT sources FROM materials WHERE snapshot='current' AND id=?").get(ref.ownerId)
        if (!m) continue
        let moved = false
        const sources = json<{ pageId: string; blockId: string }[]>(m.sources, []).map(s => {
          if (moved || s.pageId !== ref.pageId || s.blockId !== ref.blockId) return s
          moved = true
          return { ...s, pageId: to }
        })
        if (moved) { db.prepare("UPDATE materials SET sources=? WHERE snapshot='current' AND id=?").run(stringify(sources), ref.ownerId); sourcesMoved++ }
      }
    }
  }
  if (held.length) clearUndo(db)
  db.exec(`DROP TABLE ${heldPagesTable}`)
  db.exec(`DROP TABLE IF EXISTS ${heldRefsTable}`)
  return { restored: held.length, recreatedDropped, idMap: Object.fromEntries(map), sourcesMoved }
}
