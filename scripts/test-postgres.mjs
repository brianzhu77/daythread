// Runs the real-Postgres tests locally against a throwaway Postgres 17 (embedded-postgres: npm binaries, nothing
// installed on the machine). CI uses a postgres:17 service container instead.
//   node scripts/test-postgres.mjs [test files…]   (default: tests/core-postgres.test.ts)
import EmbeddedPostgres from 'embedded-postgres'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'daythread-pg-'))
const port = 54000 + Math.floor(Math.random() * 900)
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {} })
let code = 1
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('daythread_test')
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/core-postgres.test.ts']
  code = await new Promise(resolve => spawn(process.execPath, ['--test', '--test-timeout=120000', ...files], {
    stdio: 'inherit', env: { ...process.env, DATABASE_TEST_URL: `postgres://postgres:pw@127.0.0.1:${port}/daythread_test` },
  }).on('close', resolve))
} finally { await pg.stop().catch(() => {}); rmSync(dir, { recursive: true, force: true }) }
process.exit(code)
