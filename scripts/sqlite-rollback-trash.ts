// Rollback helper for A4 trash (docs/design/a4-trash-data.md §4, direction A): returns a layout-4 store to layout 3 so
// the previous build can open it, losing no content:
// - pages in the trash move to `held_trash_l4` (hidden from the old build), and the tasks, material sources and
//   captures that point at them are recorded in `held_refs_l4`; migration 4 puts them back in the trash later;
// - Undo history is cleared (it restores a whole earlier workspace that the old build can't read);
// - the `trashedAt` / `trashId` page columns are dropped.
// Stop the server first, then:  node scripts/sqlite-rollback-trash.ts <workspace.sqlite> [--backup <file>]
// A consistent backup (VACUUM INTO) is written first; if it fails or doesn't read back, nothing is touched.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import { holdTrashForLayout3 } from '../src/server/trash-rollback.ts'
import { heldLinksTable } from '../src/server/link-rollback.ts'
import { heldCardTimesTable, heldPageLinksTable } from '../src/server/page-link-rollback.ts'

const applicationId = 0x44544852
const layout4Tables = ['captures', 'events', 'materials', 'meta', 'model_attempts', 'pages', 'placements', 'receipts', 'tasks']
const path = process.argv[2]
if (!path || !existsSync(path)) throw new Error('Pass the path to an existing workspace.sqlite')
const backupFlag = process.argv.indexOf('--backup')
const backup = backupFlag > 0 ? process.argv[backupFlag + 1]! : `${path}.before-trash-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`

function checkLayout4(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA application_id').get()!.application_id) !== applicationId) throw new Error('Not a Daythread database; nothing changed')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 4) throw new Error(`Expected layout 4, found ${version}; nothing changed`)
  // A later rollback's held table (A2 `held_links_l5`) may be present; migration 5 consumes it on the way back up.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => String(t.name)).filter(t => t !== heldLinksTable && t !== heldPageLinksTable && t !== heldCardTimesTable)
  if (JSON.stringify(tables) !== JSON.stringify(layout4Tables)) throw new Error(`Unexpected tables (${tables.join(', ')}); nothing changed`)
  verifySqliteLayout(db, 4)
}
const pageColumns = (db: DatabaseSync) => db.prepare('PRAGMA table_info(pages)').all().map(c => String(c.name))

const db = new DatabaseSync(path)
try {
  db.exec('PRAGMA busy_timeout=5000')
  checkLayout4(db)
  if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
  db.prepare('VACUUM INTO ?').run(backup)
  const copy = new DatabaseSync(backup, { readOnly: true })
  try {
    checkLayout4(copy)
    if (String(copy.prepare('PRAGMA quick_check').get()!.quick_check) !== 'ok') throw new Error('Backup failed its check; nothing changed')
    const count = (d: DatabaseSync) => Number(d.prepare('SELECT count(*) AS n FROM pages').get()!.n)
    if (count(copy) !== count(db)) throw new Error('Backup does not match; nothing changed')
  } finally { copy.close() }

  db.exec('BEGIN IMMEDIATE')
  try {
    checkLayout4(db)
    const expected = pageColumns(db).filter(c => c !== 'trashedAt' && c !== 'trashId')
    const { held, refs } = holdTrashForLayout3(db)
    if (JSON.stringify(pageColumns(db)) !== JSON.stringify(expected)) throw new Error('Page columns are not layout 3 after the change')
    db.exec('PRAGMA user_version=3')
    db.exec('COMMIT')
    console.log(`Layout 4 → 3. ${held.length} page${held.length === 1 ? '' : 's'} held from the trash, ${refs} source${refs === 1 ? '' : 's'} recorded; Undo cleared. Backup at ${backup}.`)
    for (const p of held) console.log(`  held: ${p.id} "${p.title}" (batch ${p.trashId})`)
  } catch (error) { db.exec('ROLLBACK'); throw error }
} finally { db.close() }
