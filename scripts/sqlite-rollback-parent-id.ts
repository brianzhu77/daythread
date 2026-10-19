// Rollback helper for feat/page-slash: returns a layout-2 store (pages.parentId) to layout 1, so the previous build
// (which refuses newer layouts) can open it again. Subpages stay as ordinary top-level pages; their cards still open them.
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
  // `present` lists the fields a row has; drop parentId from it so layout 1 reads the rows exactly.
  for (const row of db.prepare("SELECT snapshot, id, present FROM pages WHERE present LIKE '%\"parentId\"%'").all())
    db.prepare('UPDATE pages SET present=? WHERE snapshot=? AND id=?').run(JSON.stringify((JSON.parse(String(row.present)) as string[]).filter(k => k !== 'parentId')), row.snapshot as string, row.id as string)
  db.exec('ALTER TABLE pages DROP COLUMN parentId')
  db.exec('PRAGMA user_version=1')
  db.exec('COMMIT')
  console.log(`Layout 2 → 1. ${children} subpage${children === 1 ? '' : 's'} now top level.`)
} catch (error) {
  db.exec('ROLLBACK'); throw error
} finally { db.close() }
