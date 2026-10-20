// Rollback helper for A9a page links (docs/plan/a9-page-links.md §5): returns a layout-6 store to layout 5 so the
// previous build (32ef34b) can open every page, losing no link or time:
// - each inline `[[` link becomes a plain in-app link marked `&ref=<refId>`, which 32ef34b opens; each link's identity
//   and time go to `held_page_links_l6`, and every card's time to `held_card_times_l6`; migration 6 restores them;
// - Undo history is cleared (it restores a whole earlier workspace that the old build can't read).
// No table changes. Stop the server first, then:  node scripts/sqlite-rollback-page-links.ts <workspace.sqlite> [--backup <file>]
// A consistent backup (VACUUM INTO) is written first; if it fails or doesn't read back, nothing is touched.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import { holdPageLinksForLayout5 } from '../src/server/page-link-rollback.ts'

const applicationId = 0x44544852
const layout6Tables = ['captures', 'events', 'materials', 'meta', 'model_attempts', 'pages', 'placements', 'receipts', 'tasks']
const path = process.argv[2]
if (!path || !existsSync(path)) throw new Error('Pass the path to an existing workspace.sqlite')
const backupFlag = process.argv.indexOf('--backup')
const backup = backupFlag > 0 ? process.argv[backupFlag + 1]! : `${path}.before-page-links-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`

function checkLayout6(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA application_id').get()!.application_id) !== applicationId) throw new Error('Not a Daythread database; nothing changed')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 6) throw new Error(`Expected layout 6, found ${version}; nothing changed`)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => String(t.name))
  if (JSON.stringify(tables) !== JSON.stringify(layout6Tables)) throw new Error(`Unexpected tables (${tables.join(', ')}); nothing changed`)
  verifySqliteLayout(db, 6)
}
const pageColumns = (db: DatabaseSync) => db.prepare('PRAGMA table_info(pages)').all().map(c => String(c.name))

const db = new DatabaseSync(path)
try {
  db.exec('PRAGMA busy_timeout=5000')
  checkLayout6(db)
  if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
  db.prepare('VACUUM INTO ?').run(backup)
  const copy = new DatabaseSync(backup, { readOnly: true })
  try {
    checkLayout6(copy)
    if (String(copy.prepare('PRAGMA quick_check').get()!.quick_check) !== 'ok') throw new Error('Backup failed its check; nothing changed')
    const count = (d: DatabaseSync) => Number(d.prepare('SELECT count(*) AS n FROM pages').get()!.n)
    if (count(copy) !== count(db)) throw new Error('Backup does not match; nothing changed')
  } finally { copy.close() }

  db.exec('BEGIN IMMEDIATE')
  try {
    checkLayout6(db)
    const before = pageColumns(db)
    const { links, cards } = holdPageLinksForLayout5(db)
    if (JSON.stringify(pageColumns(db)) !== JSON.stringify(before)) throw new Error('Page columns changed; layout 6 → 5 changes no table')
    db.exec('PRAGMA user_version=5')
    db.exec('COMMIT')
    console.log(`Layout 6 → 5. ${links} page link${links === 1 ? '' : 's'} now plain in-app links (marked), ${cards} card time${cards === 1 ? '' : 's'} held; Undo cleared. Backup at ${backup}.`)
  } catch (error) { db.exec('ROLLBACK'); throw error }
} finally { db.close() }
