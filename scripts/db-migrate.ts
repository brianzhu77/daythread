// Applies db/migrations to the database in DATABASE_URL. Prints the versions applied and nothing else, so no
// connection detail reaches a log.
//   node scripts/db-migrate.ts
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { migrate, readMigrations } from '../src/server/db/migrate.ts'
import { postgresClient } from '../src/server/db/sql.ts'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL (see .env.example).'); process.exit(2) }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })
try {
  const done = await migrate(postgresClient(sql), readMigrations(fileURLToPath(new URL('../db/migrations', import.meta.url))))
  console.log(done.length ? `applied: ${done.join(', ')}` : 'up to date')
} finally { await sql.end() }
