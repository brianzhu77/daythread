// Rollback helper for A11 (docs/plan/a11-line-links.md §6): returns a layout-7 store to layout 6 so the previous build
// can open it. Layout 7 only adds `tasks.doneOn`; this drops the column. A done task then counts as finished on its
// derived day (its latest included day, else its plan day), as a task done before A11 does; migration 7 adds the
// column back empty. Nothing else changes, and Undo history is kept (its rows lose the same column).
// Stop the server first, then:  node scripts/sqlite-rollback-done-on.ts <workspace.sqlite> [--backup <file>]
// A consistent backup (VACUUM INTO) is written first; if it fails or doesn't read back, nothing is touched.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'

const applicationId = 0x44544852
const layout7Tables = ['captures', 'events', 'materials', 'meta', 'model_attempts', 'pages', 'placements', 'receipts', 'tasks']
const path = process.argv[2]
if (!path || !existsSync(path)) throw new Error('Pass the path to an existing workspace.sqlite')
const backupFlag = process.argv.indexOf('--backup')
const backup = backupFlag > 0 ? process.argv[backupFlag + 1]! : `${path}.before-done-on-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`

function checkLayout7(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA application_id').get()!.application_id) !== applicationId) throw new Error('Not a Daythread database; nothing changed')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 7) throw new Error(`Expected layout 7, found ${version}; nothing changed`)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => String(t.name))
  if (JSON.stringify(tables) !== JSON.stringify(layout7Tables)) throw new Error(`Unexpected tables (${tables.join(', ')}); nothing changed`)
  verifySqliteLayout(db, 7)
}

const db = new DatabaseSync(path)
try {
  db.exec('PRAGMA busy_timeout=5000')
  checkLayout7(db)
  if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
  db.prepare('VACUUM INTO ?').run(backup)
  const copy = new DatabaseSync(backup, { readOnly: true })
  try {
    checkLayout7(copy)
    if (String(copy.prepare('PRAGMA quick_check').get()!.quick_check) !== 'ok') throw new Error('Backup failed its check; nothing changed')
    const count = (d: DatabaseSync) => Number(d.prepare('SELECT count(*) AS n FROM tasks').get()!.n)
    if (count(copy) !== count(db)) throw new Error('Backup does not match; nothing changed')
  } finally { copy.close() }

  db.exec('BEGIN IMMEDIATE')
  try {
    checkLayout7(db)
    const dated = Number(db.prepare("SELECT count(*) AS n FROM tasks WHERE snapshot='current' AND doneOn IS NOT NULL").get()!.n)
    db.exec('ALTER TABLE tasks DROP COLUMN "doneOn"')
    // `present` lists the fields a row had; the layout-6 build reads only its own columns from it.
    db.exec(`UPDATE tasks SET present = (SELECT json_group_array(value) FROM json_each(tasks.present) WHERE value <> 'doneOn') WHERE present LIKE '%"doneOn"%'`)
    db.exec('PRAGMA user_version=6')
    verifySqliteLayout(db, 6)
    db.exec('COMMIT')
    console.log(`Layout 7 → 6. ${dated} done day${dated === 1 ? '' : 's'} dropped (those tasks use their derived day). Backup at ${backup}.`)
  } catch (error) { db.exec('ROLLBACK'); throw error }
} finally { db.close() }
