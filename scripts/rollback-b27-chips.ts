// Rollback helper for B27 (Lead dee40862): before going back to a build from before B27, turn every `@date` chip into
// its text (`@Nov 20 3pm`) on every page (trashed ones too), so that build can open every page, and clear Undo, which
// could bring a chip back. His words, blocks, ids and the revision stay the same; only the chip becomes the text the
// line already stores. Safe to run twice (the second run finds nothing).
//
//   SQLite (stop the server first):
//     node scripts/rollback-b27-chips.ts sqlite <workspace.sqlite> [--backup <file>] [--dry-run]
//     A consistent backup (VACUUM INTO) is written first; if it fails or doesn't read back, nothing is touched.
//   Postgres (DAYTHREAD_STORAGE=postgres, DATABASE_URL, optional DAYTHREAD_PG_SCHEMA; the server may stay up):
//     node scripts/rollback-b27-chips.ts postgres [--backup <file.json>] [--dry-run]
//     One locked transaction: the row's document as it was goes to the backup file first, then the rewrite.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chipsAsText, chipsAsTextPostgres, chipsAsTextSqlite } from '../src/server/chip-rollback.ts'
import { postgresSql } from '../src/server/storage.ts'
import { schemaName } from '../src/server/postgres-repository.ts'
import type { Workspace } from '../src/domain/types.ts'

const [kind, ...rest] = process.argv.slice(2)
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
const dryRun = rest.includes('--dry-run')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = (r: { chips: number; undoCleared: boolean }) => `${r.chips} chip${r.chips === 1 ? '' : 's'} ${dryRun ? 'would become' : 'now'} text; Undo ${r.undoCleared ? (dryRun ? 'would be cleared' : 'cleared') : 'was empty'}`

if (kind === 'sqlite') {
  const path = rest[0]
  if (!path || path.startsWith('--') || !existsSync(path)) throw new Error('Pass the path to an existing workspace.sqlite')
  const backup = flag('--backup') ?? `${path}.before-b27-chips-rollback-${stamp}.sqlite`
  const db = new DatabaseSync(path, dryRun ? { readOnly: true } : {})
  try {
    db.exec('PRAGMA busy_timeout=5000')
    if (Number(db.prepare('PRAGMA application_id').get()!.application_id) !== 0x44544852) throw new Error('Not a Daythread database; nothing changed')
    if (dryRun) console.log(`Dry run: ${report(chipsAsTextSqlite(db, true))}.`)
    else {
      if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
      db.prepare('VACUUM INTO ?').run(backup)
      const copy = new DatabaseSync(backup, { readOnly: true })
      try {
        if (String(copy.prepare('PRAGMA quick_check').get()!.quick_check) !== 'ok') throw new Error('Backup failed its check; nothing changed')
        const count = (d: DatabaseSync) => Number(d.prepare('SELECT count(*) AS n FROM pages').get()!.n)
        if (count(copy) !== count(db)) throw new Error('Backup does not match; nothing changed')
      } finally { copy.close() }
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = chipsAsTextSqlite(db)
        db.exec('COMMIT')
        console.log(`${report(result)}. Backup at ${backup}.`)
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
  } finally { db.close() }
} else if (kind === 'postgres') {
  const sql = postgresSql(), table = `${schemaName()}.workspace`
  if (dryRun) {
    const [row] = await sql.query<{ data: string }>(`select data::text as data from ${table} where id = 1`)
    if (!row) throw new Error('Workspace missing')
    console.log(`Dry run: ${report(chipsAsText(JSON.parse(row.data) as Workspace))}.`)
  } else {
    const backup = flag('--backup') ?? `b27-chips-rollback-backup-${stamp}.json`
    if (existsSync(backup)) throw new Error(`Backup ${backup} already exists; nothing changed`)
    // The backup is the row as it is under the lock, written and read back before anything changes.
    const result = await chipsAsTextPostgres(sql, table, data => {
      writeFileSync(backup, data, { flag: 'wx', mode: 0o600 })
      if (readFileSync(backup, 'utf8') !== data) throw new Error('Backup does not read back; nothing changed')
    })
    console.log(`${report(result)} (revision ${result.revision} unchanged). Backup at ${backup}.`)
  }
  process.exit(0)
} else {
  throw new Error('Usage: rollback-b27-chips.ts sqlite <workspace.sqlite> [--backup <file>] [--dry-run] | postgres [--backup <file.json>] [--dry-run]')
}
