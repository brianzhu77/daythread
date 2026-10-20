// A2 rollback (docs/plan/a2-url-page.md §5): the layout-5 → 4 step the rollback script runs, and the step migration 5
// runs when it finds what that script held. Both run inside the caller's transaction, so any error leaves the database
// as it was. Identity is kept in `held_links_l5` by page id with the raw URL, never guessed back from the page text.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { urlKey } from '../domain/url-key.ts'

export const heldLinksTable = 'held_links_l5'
const entityTables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts'] as const
type Row = Record<string, SQLInputValue>
type Block = { id: string; kind: string; text: string }
type Section = { id: string; title: string; blocks: Block[] }
type Node = { id: string; type: string; content?: unknown; children?: Node[] }

const tableExists = (db: DatabaseSync, name: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
const json = <T>(value: unknown, fallback: T): T => (typeof value === 'string' && value ? JSON.parse(value) as T : fallback)
const inlineText = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c: { text?: unknown; content?: unknown }) => 'text' in c ? String(c.text) : 'content' in c ? inlineText(c.content) : '').join('') : ''

/** Undo restores a whole earlier workspace, so it's cleared whenever the layout changes outside a command. */
function clearUndo(db: DatabaseSync): void {
  for (const table of entityTables) db.prepare(`DELETE FROM ${table} WHERE snapshot='undo'`).run()
  db.prepare("DELETE FROM meta WHERE snapshot='undo'").run()
  db.prepare("UPDATE meta SET undoOperationId=NULL, undoRevision=NULL WHERE snapshot='current'").run()
}
const lineId = (pageId: string) => `link-url:${pageId}`
const urlNode = (id: string, url: string): Node => ({ id, type: 'paragraph', content: [{ type: 'link', href: url, content: [{ type: 'text', text: url, styles: {} }] }] })

export interface HeldLinks { held: { pageId: string; url: string }[] }

/**
 * Layout 5 → 4. Each link page's id and raw URL go to `held_links_l5`; so the old build still shows it, the URL is
 * written as the page's first line (its block id and text are held too, so the re-upgrade can take exactly that line
 * out again). Then the `url` column is dropped. Materials keep their own `url` and need nothing.
 */
export function holdLinksForLayout4(db: DatabaseSync): HeldLinks {
  if (tableExists(db, heldLinksTable)) throw new Error('Held links table already exists; nothing changed')
  db.exec(`CREATE TABLE ${heldLinksTable} (pageId TEXT PRIMARY KEY, url TEXT NOT NULL, lineBlockId TEXT NOT NULL, lineText TEXT NOT NULL) STRICT`)
  const rows = db.prepare(`SELECT id, url, sections, editorJSON, editorSections FROM pages WHERE snapshot='current' AND url IS NOT NULL ORDER BY position`).all() as Row[]
  const record = db.prepare(`INSERT INTO ${heldLinksTable} (pageId, url, lineBlockId, lineText) VALUES (?, ?, ?, ?)`)
  const held: HeldLinks['held'] = []
  for (const row of rows) {
    const pageId = String(row.id), url = String(row.url), id = lineId(pageId)
    const sections = json<Section[]>(row.sections, [])
    const inSync = typeof row.editorJSON === 'string' && row.editorSections === JSON.stringify(sections)
    if (!sections.length) sections.push({ id: `intro:${pageId}`, title: '', blocks: [] } as Section & { kind?: string })
    sections[0]!.blocks.unshift({ id, kind: 'paragraph', text: url })
    let editorJSON = row.editorJSON
    if (typeof editorJSON === 'string' && editorJSON) {
      const doc = json<Node[]>(editorJSON, [])
      const first = doc.findIndex(n => n.id === sections[0]!.id)
      doc.splice(first >= 0 ? first + 1 : 0, 0, urlNode(id, url))
      editorJSON = JSON.stringify(doc)
    }
    db.prepare("UPDATE pages SET sections=?, editorJSON=?, editorSections=? WHERE snapshot='current' AND id=?")
      .run(JSON.stringify(sections), editorJSON, inSync ? JSON.stringify(sections) : row.editorSections, pageId)
    record.run(pageId, url, id, url)
    held.push({ pageId, url })
  }
  // A link card's `url` / `line` props are A2's; the layout-4 card is `{ pageId }` only. After the re-upgrade a card
  // reads its URL from the page again.
  const stripCard = (list: Node[]): Node[] => list.map(n => {
    const props = (n as Node & { props?: Record<string, unknown> }).props
    const next = n.type === 'pageLink' && props && ('url' in props || 'line' in props) ? { ...n, props: { pageId: props.pageId } } : n
    return next.children ? { ...next, children: stripCard(next.children) } : next
  })
  for (const row of db.prepare("SELECT id, editorJSON FROM pages WHERE snapshot='current' AND editorJSON IS NOT NULL").all()) {
    const doc = json<Node[]>(row.editorJSON, [])
    const next = JSON.stringify(stripCard(doc))
    if (next !== row.editorJSON) db.prepare("UPDATE pages SET editorJSON=? WHERE snapshot='current' AND id=?").run(next, row.id as string)
  }
  // The layout-4 build reads only the fields it knows, but `present` must not list one it can't store.
  for (const row of db.prepare("SELECT snapshot, id, present FROM pages").all()) {
    const present = json<string[]>(row.present, [])
    if (present.includes('url')) db.prepare('UPDATE pages SET present=? WHERE snapshot=? AND id=?').run(JSON.stringify(present.filter(k => k !== 'url')), row.snapshot as string, row.id as string)
  }
  clearUndo(db)
  db.exec('ALTER TABLE pages DROP COLUMN "url"')
  return { held }
}

export interface LinksReupgradeLog { restored: number; gone: string[]; keyTaken: string[]; linesRemoved: number; linesKept: string[] }

/**
 * Migration 5's second half. Each held page that still exists (live or in the trash) gets its URL back, unless another
 * page has taken that key meanwhile, which is reported rather than overwritten. The URL line the script wrote is
 * removed only if a block with that id still holds exactly that text; one he edited stays.
 */
export function restoreHeldLinks(db: DatabaseSync): LinksReupgradeLog | null {
  if (!tableExists(db, heldLinksTable)) return null
  const held = db.prepare(`SELECT * FROM ${heldLinksTable}`).all() as { pageId: string; url: string; lineBlockId: string; lineText: string }[]
  const owners = new Map<string, string>()
  for (const p of db.prepare("SELECT id, url FROM pages WHERE snapshot='current' AND url IS NOT NULL").all())
    owners.set(urlKey(String(p.url)) ?? '', String(p.id))
  const log: LinksReupgradeLog = { restored: 0, gone: [], keyTaken: [], linesRemoved: 0, linesKept: [] }
  for (const h of held) {
    const row = db.prepare("SELECT id, present, sections, editorJSON, editorSections FROM pages WHERE snapshot='current' AND id=?").get(h.pageId) as Row | undefined
    if (!row) { log.gone.push(h.pageId); continue }
    const key = urlKey(h.url)
    if (key === null || (owners.has(key) && owners.get(key) !== h.pageId)) log.keyTaken.push(h.pageId)
    else {
      owners.set(key, h.pageId)
      const present = json<string[]>(row.present, [])
      db.prepare("UPDATE pages SET url=?, present=? WHERE snapshot='current' AND id=?").run(h.url, JSON.stringify(present.includes('url') ? present : [...present, 'url']), h.pageId)
      log.restored++
    }
    const sections = json<Section[]>(row.sections, [])
    const inSync = row.editorSections === JSON.stringify(sections)
    const holder = sections.find(s => s.blocks.some(b => b.id === h.lineBlockId))
    const block = holder?.blocks.find(b => b.id === h.lineBlockId)
    // Notes he nested under the URL line in the old build are about that link: the whole line stays (Ratchet 832ad8f0,
    // Bumblebee b5c4af03), like an edited one.
    const findNode = (list: Node[]): Node | undefined => list.map(n => n.id === h.lineBlockId ? n : n.children && findNode(n.children)).find(Boolean)
    const node = typeof row.editorJSON === 'string' && row.editorJSON ? findNode(json<Node[]>(row.editorJSON, [])) : undefined
    if (!holder || !block || block.text !== h.lineText || node?.children?.length) { log.linesKept.push(h.pageId); continue }
    holder.blocks = holder.blocks.filter(b => b !== block)
    let editorJSON = row.editorJSON
    if (typeof editorJSON === 'string' && editorJSON) {
      const drop = (list: Node[]): Node[] => list.filter(n => !(n.id === h.lineBlockId && inlineText(n.content) === h.lineText)).map(n => n.children ? { ...n, children: drop(n.children) } : n)
      editorJSON = JSON.stringify(drop(json<Node[]>(editorJSON, [])))
    }
    db.prepare("UPDATE pages SET sections=?, editorJSON=?, editorSections=? WHERE snapshot='current' AND id=?")
      .run(JSON.stringify(sections), editorJSON, inSync ? JSON.stringify(sections) : row.editorSections, h.pageId)
    log.linesRemoved++
  }
  if (held.length) clearUndo(db)
  db.exec(`DROP TABLE ${heldLinksTable}`)
  return log
}
