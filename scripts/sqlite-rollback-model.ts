// Rollback helper for feat/model step 1: returns a layout-3 store to layout 2 so the previous build can open it,
// losing nothing written since the deploy:
// - captures still waiting for the model become "failed" with their text kept;
// - the capture columns `model` / `mode` are dropped (and removed from each row's `present` list);
// - the budget ledger `model_attempts` is KEPT (the previous build only checks the tables it knows), and also written
//   to <db>.model-ledger-<time>.json, so today's spend survives a round trip (Ratchet 81a1eb86).
// Stop the server first, keep the pre-deploy backup, then:  node scripts/sqlite-rollback-model.ts <workspace.sqlite>
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) throw new Error('Pass the path to workspace.sqlite')
const db = new DatabaseSync(path)
try {
  db.exec('BEGIN IMMEDIATE')
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (version !== 3) throw new Error(`Expected layout 3, found ${version}; nothing changed`)
  const attempts = db.prepare('SELECT * FROM model_attempts ORDER BY createdAt, id').all()
  const copy = `${path}.model-ledger-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(copy, JSON.stringify(attempts, null, 2))
  const organizing = Number(db.prepare("UPDATE captures SET status='failed', error=COALESCE(error, 'Rolled back while organizing; your text is kept') WHERE status='organizing'").run().changes)
  for (const row of db.prepare("SELECT snapshot, id, present FROM captures WHERE present LIKE '%\"model\"%' OR present LIKE '%\"mode\"%'").all())
    db.prepare('UPDATE captures SET present=? WHERE snapshot=? AND id=?').run(JSON.stringify((JSON.parse(String(row.present)) as string[]).filter(k => k !== 'model' && k !== 'mode')), row.snapshot as string, row.id as string)
  db.exec('ALTER TABLE captures DROP COLUMN model')
  db.exec('ALTER TABLE captures DROP COLUMN mode')
  db.exec('PRAGMA user_version=2')
  db.exec('COMMIT')
  console.log(`Layout 3 → 2. ${organizing} capture${organizing === 1 ? '' : 's'} marked failed (text kept); ledger kept (${attempts.length} attempt${attempts.length === 1 ? '' : 's'}), copy at ${copy}.`)
} catch (error) {
  db.exec('ROLLBACK'); throw error
} finally { db.close() }
