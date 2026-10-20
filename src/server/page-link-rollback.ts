// A9a layout 6 (docs/plan/a9-page-links.md §2, §5). Inline `[[` links are a document format 32ef34b can't open, so:
// - the rollback (6 → 5) turns each link into a plain in-app link marked with its own `ref`, and holds every link's
//   and card's identity and time;
// - migration 6 turns the marked links back (by marker only) and gives the held times back;
// - migration 6 also stamps, once, every reference that has no time yet, in the order Linked from shows that day.
// All of it runs inside the caller's transaction.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export const heldPageLinksTable = 'held_page_links_l6'
export const heldCardTimesTable = 'held_card_times_l6'
const entityTables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts'] as const
type Row = Record<string, SQLInputValue>
type Ref = { refId: string; pageId: string; at?: number; title: string; pending?: boolean }
type Block = { id: string; kind: string; text: string; targetPageId?: string; at?: number; refs?: Ref[] }
type Section = { id: string; blocks: Block[] }
type Inline = { type?: string; text?: string; href?: string; content?: unknown; props?: Record<string, unknown>; styles?: unknown }
type Node = { id: string; type: string; content?: unknown; children?: Node[] }

const tableExists = (db: DatabaseSync, name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
const json = <T>(value: unknown, fallback: T): T => (typeof value === 'string' && value ? JSON.parse(value) as T : fallback)
const textOf = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? (content as Inline[]).map(c => c.type === 'text' ? String(c.text ?? '') : textOf(c.content)).join('') : ''
export const markedHref = (pageId: string, refId: string) => `/pages?page=${encodeURIComponent(pageId)}&ref=${encodeURIComponent(refId)}`

function clearUndo(db: DatabaseSync): void {
  for (const table of entityTables) db.prepare(`DELETE FROM ${table} WHERE snapshot='undo'`).run()
  db.prepare("DELETE FROM meta WHERE snapshot='undo'").run()
  db.prepare("UPDATE meta SET undoOperationId=NULL, undoRevision=NULL WHERE snapshot='current'").run()
}
function mapNodes(nodes: Node[], fn: (n: Node) => Node): Node[] {
  return nodes.map(n => { const m = fn(n); return m.children ? { ...m, children: mapNodes(m.children, fn) } : m })
}
/** Write sections back; `editorSections` follows only if it was in step, so the editor keeps reading the same thing. */
function writeSections(db: DatabaseSync, row: Row, sections: Section[], editorJSON: SQLInputValue = row.editorJSON): void {
  const inSync = row.editorSections === row.sections
  db.prepare("UPDATE pages SET sections=?, editorJSON=?, editorSections=? WHERE snapshot='current' AND id=?")
    .run(JSON.stringify(sections), editorJSON, inSync ? JSON.stringify(sections) : row.editorSections, row.id as string)
}
const currentPages = (db: DatabaseSync) => db.prepare("SELECT id, type, date, title, position, sections, editorJSON, editorSections FROM pages WHERE snapshot='current' ORDER BY position").all() as Row[]

export interface HeldPageLinks { links: number; cards: number }

/** Layout 6 → 5 (plan §5). */
export function holdPageLinksForLayout5(db: DatabaseSync): HeldPageLinks {
  if (tableExists(db, heldPageLinksTable) || tableExists(db, heldCardTimesTable)) throw new Error('Held page-link tables already exist; nothing changed')
  db.exec(`CREATE TABLE ${heldPageLinksTable} (pageId TEXT NOT NULL, blockId TEXT NOT NULL, refId TEXT NOT NULL, targetPageId TEXT NOT NULL, href TEXT NOT NULL, text TEXT NOT NULL, at INTEGER, pending INTEGER NOT NULL, newTitle TEXT, PRIMARY KEY (pageId, refId)) STRICT`)
  db.exec(`CREATE TABLE ${heldCardTimesTable} (pageId TEXT NOT NULL, blockId TEXT NOT NULL, targetPageId TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (pageId, blockId)) STRICT`)
  const rows = currentPages(db)
  const titles = new Map(rows.map(r => [String(r.id), String(r.title ?? '')]))
  const holdLink = db.prepare(`INSERT INTO ${heldPageLinksTable} (pageId, blockId, refId, targetPageId, href, text, at, pending, newTitle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const holdCard = db.prepare(`INSERT INTO ${heldCardTimesTable} (pageId, blockId, targetPageId, at) VALUES (?, ?, ?, ?)`)
  let links = 0, cards = 0
  for (const row of rows) {
    const pageId = String(row.id), sections = json<Section[]>(row.sections, [])
    const blocks = new Map(sections.flatMap(s => s.blocks).map(b => [b.id, b]))
    for (const b of blocks.values()) if (b.kind === 'reference' && b.targetPageId && b.at !== undefined) { holdCard.run(pageId, b.id, b.targetPageId, b.at); cards++ }
    if (typeof row.editorJSON !== 'string' || !row.editorJSON.includes('"pageRef"')) continue
    const convert = (blockId: string) => (content: unknown): unknown => Array.isArray(content) ? (content as Inline[]).map(c => {
      if (c?.type !== 'pageRef') return c && typeof c === 'object' && Array.isArray(c.content) ? { ...c, content: convert(blockId)(c.content) } : c
      const refId = String(c.props?.refId ?? ''), target = String(c.props?.pageId ?? ''), newTitle = c.props?.newTitle ? String(c.props.newTitle) : null
      const text = titles.get(target) || newTitle || 'Page not found', href = markedHref(target, refId)
      const held = blocks.get(blockId)?.refs?.find(r => r.refId === refId)
      holdLink.run(pageId, blockId, refId, target, href, text, held?.at ?? null, held?.pending ? 1 : 0, newTitle); links++
      return { type: 'link', href, content: [{ type: 'text', text, styles: {} }] }
    }) : content
    const doc = mapNodes(json<Node[]>(row.editorJSON, []), n => Array.isArray(n.content) ? { ...n, content: convert(n.id)(n.content) } : n)
    db.prepare("UPDATE pages SET editorJSON=? WHERE snapshot='current' AND id=?").run(JSON.stringify(doc), pageId)
  }
  clearUndo(db)
  return { links, cards }
}

export interface PageLinksReupgradeLog { linksRestored: number; linksKeptPlain: number; cardTimesRestored: number; stamped: number }

/** Migration 6, first half: marked links back to `[[` links, by marker only, with their held times; cards' held times. */
export function restoreHeldPageLinks(db: DatabaseSync): Omit<PageLinksReupgradeLog, 'stamped'> | null {
  if (!tableExists(db, heldPageLinksTable) && !tableExists(db, heldCardTimesTable)) return null
  const log = { linksRestored: 0, linksKeptPlain: 0, cardTimesRestored: 0 }
  const held = tableExists(db, heldPageLinksTable) ? db.prepare(`SELECT * FROM ${heldPageLinksTable}`).all() as { pageId: string; blockId: string; refId: string; targetPageId: string; href: string; text: string; at: number | null; pending: number; newTitle: string | null }[] : []
  const cardTimes = tableExists(db, heldCardTimesTable) ? db.prepare(`SELECT * FROM ${heldCardTimesTable}`).all() as { pageId: string; blockId: string; targetPageId: string; at: number }[] : []
  for (const row of currentPages(db)) {
    const pageId = String(row.id)
    const mine = held.filter(h => h.pageId === pageId), myCards = cardTimes.filter(c => c.pageId === pageId)
    if (!mine.length && !myCards.length) continue
    const used = new Set<string>(), restored: typeof mine = []
    const back = (blockId: string) => (content: unknown): unknown => Array.isArray(content) ? (content as Inline[]).map(c => {
      if (c?.type !== 'link') return c
      const h = mine.find(x => x.blockId === blockId && x.href === c.href && !used.has(x.refId))
      if (!h || textOf(c.content) !== h.text) return c
      used.add(h.refId); restored.push(h)
      return { type: 'pageRef', props: { pageId: h.targetPageId, refId: h.refId, ...(h.newTitle ? { newTitle: h.newTitle } : {}) } }
    }) : content
    const doc = typeof row.editorJSON === 'string' && row.editorJSON ? mapNodes(json<Node[]>(row.editorJSON, []), n => Array.isArray(n.content) ? { ...n, content: back(n.id)(n.content) } : n) : null
    const sections = json<Section[]>(row.sections, [])
    for (const b of sections.flatMap(s => s.blocks)) {
      // A line that had held links gets exactly the ones restored; a link left plain is no longer a reference.
      const mineHere = restored.filter(h => h.blockId === b.id)
      if (mine.some(h => h.blockId === b.id) && !mineHere.length) delete b.refs
      if (mineHere.length) b.refs = mineHere.map(h => ({ refId: h.refId, pageId: h.targetPageId, ...(h.at !== null ? { at: h.at } : {}), title: h.text, ...(h.pending ? { pending: true } : {}) }))
      const card = myCards.find(c => c.blockId === b.id && c.targetPageId === b.targetPageId)
      if (b.kind === 'reference' && card) { b.at = card.at; log.cardTimesRestored++ }
    }
    log.linksRestored += restored.length
    log.linksKeptPlain += mine.length - restored.length
    writeSections(db, row, sections, doc ? JSON.stringify(doc) : row.editorJSON)
  }
  if (held.length || cardTimes.length) clearUndo(db)
  db.exec(`DROP TABLE IF EXISTS ${heldPageLinksTable}`)
  db.exec(`DROP TABLE IF EXISTS ${heldCardTimesTable}`)
  return log
}

/**
 * Migration 6, second half (plan §2, Ratchet c293ef38): every reference with no time gets one, once, below every real
 * revision, in the order Linked from shows that day (days newest first, then documents newest first in stored order).
 * From then on a move can't reorder them. Returns how many references were stamped.
 */
export function stampUntimedReferences(db: DatabaseSync): number {
  const rows = currentPages(db)
  const pages = rows.map(r => ({ row: r, id: String(r.id), type: String(r.type), date: (r.date as string | null) ?? '', sections: json<Section[]>(r.sections, []) }))
  const legacyRank = (ids: Set<string>) => [
    ...pages.filter(p => ids.has(p.id) && p.type === 'daily').sort((a, b) => b.date.localeCompare(a.date)),
    ...pages.filter(p => ids.has(p.id) && p.type !== 'daily').reverse(),
  ].map(p => p.id)
  let stamped = 0
  const touched = new Set<string>()
  for (const target of pages) {
    const untimed = (p: typeof pages[number]) => p.id !== target.id && p.sections.some(s => s.blocks.some(b =>
      (b.kind === 'reference' && b.targetPageId === target.id && b.at === undefined) || (b.refs ?? []).some(r => r.pageId === target.id && r.at === undefined)))
    const order = legacyRank(new Set(pages.filter(untimed).map(p => p.id)))
    order.forEach((sourceId, i) => {
      const at = -(i + 1)
      for (const b of pages.find(p => p.id === sourceId)!.sections.flatMap(s => s.blocks)) {
        if (b.kind === 'reference' && b.targetPageId === target.id && b.at === undefined) { b.at = at; stamped++ }
        for (const r of b.refs ?? []) if (r.pageId === target.id && r.at === undefined) { r.at = at; stamped++ }
      }
      touched.add(sourceId)
    })
  }
  for (const p of pages) if (touched.has(p.id)) writeSections(db, p.row, p.sections)
  return stamped
}
