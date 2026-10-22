import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SqlClient } from './sql.ts'

export interface Migration { version: string; sql: string; checksum: string }

export function readMigrations(directory: string): Migration[] {
  return readdirSync(directory).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => {
    const sql = readFileSync(join(directory, f), 'utf8')
    return { version: f.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') }
  })
}

/**
 * Applies each migration not yet recorded, in order, each in its own transaction with its bookkeeping row, so a failed
 * migration leaves nothing behind. An applied migration whose file has changed since is an error: migrations are
 * append-only, a fix is a new file.
 */
export async function migrate(db: SqlClient, migrations: Migration[]): Promise<string[]> {
  await db.exec(`create table if not exists public.daythread_migrations (
    version text primary key, checksum text not null, applied_at timestamptz not null default now())`)
  const applied = new Map((await db.query<{ version: string; checksum: string }>('select version, checksum from public.daythread_migrations')).map(r => [r.version, r.checksum]))
  for (const [version, checksum] of applied) {
    const file = migrations.find(m => m.version === version)
    if (!file) throw new Error(`Applied migration ${version} has no file`)
    if (file.checksum !== checksum) throw new Error(`Migration ${version} changed after it was applied; add a new migration instead`)
  }
  const done: string[] = []
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    await db.transaction(async tx => {
      await tx.exec(m.sql)
      await tx.query('insert into public.daythread_migrations (version, checksum) values ($1, $2)', [m.version, m.checksum])
    })
    done.push(m.version)
  }
  return done
}
