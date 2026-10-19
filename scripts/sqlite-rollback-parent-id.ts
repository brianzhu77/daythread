// Rollback helper for feat/page-slash: returns a layout-2 store (pages.parentId) to layout 1, so the previous build
// (which refuses newer layouts) can open it again, losing nothing written since the deploy:
// - subpages stay as ordinary top-level pages;
// - each page card in saved editor content becomes what the previous build used for page references, a paragraph
//   holding a link to the page, with the same block id and position (Ratchet #64: the old editor can't load `pageLink`).
// Stop the server first, keep the pre-deploy backup, then:
//   node scripts/sqlite-rollback-parent-id.ts <path to workspace.sqlite>
import { DatabaseSync } from 'node:sqlite'

const path = process.argv[2]
if (!path) throw new Error('Pass the path to workspace.sqlite')
const db = new DatabaseSync(path)
try {
  db.exec('BEGIN IMMEDIATE')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 2) throw new Error(`Expected layout 2, found ${version}; nothing changed`)
  const children = Number(db.prepare("SELECT count(*) AS n FROM pages WHERE snapshot='current' AND parentId IS NOT NULL").get()!.n)
  type Node = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: Node[] }
  let cards = 0
  for (const row of db.prepare("SELECT snapshot, id, editorJSON FROM pages WHERE editorJSON LIKE '%\"pageLink\"%'").all()) {
    const titleOf = (pageId: string) => String((db.prepare('SELECT title FROM pages WHERE snapshot=? AND id=?').get(row.snapshot as string, pageId)?.title as string | undefined) || 'Untitled')
    const downgrade = (node: Node): Node => node.type === 'pageLink'
      ? (cards++, { id: node.id, type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'link', href: `/pages?page=${encodeURIComponent(String(node.props?.pageId ?? ''))}`, content: [{ type: 'text', text: titleOf(String(node.props?.pageId ?? '')), styles: {} }] }], children: [] })
      : { ...node, ...(node.children ? { children: node.children.map(downgrade) } : {}) }
    const nodes = (JSON.parse(String(row.editorJSON)) as Node[]).map(downgrade)
    db.prepare('UPDATE pages SET editorJSON=? WHERE snapshot=? AND id=?').run(JSON.stringify(nodes), row.snapshot as string, row.id as string)
  }
  // `present` lists the fields a row has; drop parentId from it so layout 1 reads the rows exactly.
  for (const row of db.prepare("SELECT snapshot, id, present FROM pages WHERE present LIKE '%\"parentId\"%'").all())
    db.prepare('UPDATE pages SET present=? WHERE snapshot=? AND id=?').run(JSON.stringify((JSON.parse(String(row.present)) as string[]).filter(k => k !== 'parentId')), row.snapshot as string, row.id as string)
  db.exec('ALTER TABLE pages DROP COLUMN parentId')
  db.exec('PRAGMA user_version=1')
  db.exec('COMMIT')
  console.log(`Layout 2 → 1. ${children} subpage${children === 1 ? '' : 's'} now top level; ${cards} page card${cards === 1 ? '' : 's'} (all snapshots) now links.`)
} catch (error) {
  db.exec('ROLLBACK'); throw error
} finally { db.close() }
