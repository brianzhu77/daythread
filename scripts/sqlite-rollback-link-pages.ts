// Rollback helper for A2 link pages (docs/plan/a2-url-page.md §5): returns a layout-5 store to layout 4 so the previous
// build can open it, losing no link:
// - each link page's id and raw URL go to `held_links_l5`, and the URL is written as the page's first line so the old
//   build shows it; migration 5 puts the URLs back and takes that line out again if it's unchanged;
// - Undo history is cleared (it restores a whole earlier workspace that the old build can't read);
// - the `url` page column is dropped. Saved items (materials) keep their own `url` and are untouched.
// Stop the server first, then:  node scripts/sqlite-rollback-link-pages.ts <workspace.sqlite> [--backup <file>]
// A consistent backup (VACUUM INTO) is written first; if it fails or doesn't read back, nothing is touched.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import { holdLinksForLayout4 } from '../src/server/link-rollback.ts'

const applicationId = 0x44544852
const layout5Tables = ['captures', 'events', 'materials', 'meta', 'model_attempts', 'pages', 'placements', 'receipts', 'tasks']
const path = process.argv[2]
if (!path || !existsSync(path)) throw new Error('Pass the path to an existing workspace.sqlite')
const backupFlag = process.argv.indexOf('--backup')
const backup = backupFlag > 0 ? process.argv[backupFlag + 1]! : `${path}.before-links-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`

function checkLayout5(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA application_id').get()!.application_id) !== applicationId) throw new Error('Not a Daythread database; nothing changed')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 5) throw new Error(`Expected layout 5, found ${version}; nothing changed`)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => String(t.name))
  if (JSON.stringify(tables) !== JSON.stringify(layout5Tables)) throw new Error(`Unexpected tables (${tables.join(', ')}); nothing changed`)
  verifySqliteLayout(db)
}
const pageColumns = (db: DatabaseSync) => db.prepare('PRAGMA table_info(pages)').all().map(c => String(c.name))

const db = new DatabaseSync(path)
try {
  db.exec('PRAGMA busy_timeout=5000')
  checkLayout5(db)
  if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
  db.prepare('VACUUM INTO ?').run(backup)
  const copy = new DatabaseSync(backup, { readOnly: true })
  try {
    checkLayout5(copy)
    if (String(copy.prepare('PRAGMA quick_check').get()!.quick_check) !== 'ok') throw new Error('Backup failed its check; nothing changed')
    const count = (d: DatabaseSync) => Number(d.prepare('SELECT count(*) AS n FROM pages').get()!.n)
    if (count(copy) !== count(db)) throw new Error('Backup does not match; nothing changed')
  } finally { copy.close() }

  db.exec('BEGIN IMMEDIATE')
  try {
    checkLayout5(db)
    const expected = pageColumns(db).filter(c => c !== 'url')
    const { held } = holdLinksForLayout4(db)
    if (JSON.stringify(pageColumns(db)) !== JSON.stringify(expected)) throw new Error('Page columns are not layout 4 after the change')
    db.exec('PRAGMA user_version=4')
    db.exec('COMMIT')
    console.log(`Layout 5 → 4. ${held.length} link page${held.length === 1 ? '' : 's'} held, each URL also written as its page's first line; Undo cleared. Backup at ${backup}.`)
    for (const h of held) console.log(`  held: ${h.pageId} ${h.url}`)
  } catch (error) { db.exec('ROLLBACK'); throw error }
} finally { db.close() }
