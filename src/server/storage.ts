import { resolve } from 'node:path'
import postgres from 'postgres'
import type { ServerRepository } from './repository.ts'
import { SqliteWorkspaceRepository } from './sqlite-repository.ts'
import { PostgresWorkspaceRepository } from './postgres-repository.ts'
import { postgresClient } from './db/sql.ts'
let repository: ServerRepository | undefined
/** DAYTHREAD_STORAGE picks the store: `postgres` (DATABASE_URL must be set in the environment) or `sqlite`. */
export function getRepository(): ServerRepository {
  if (repository) return repository
  const storage = process.env.DAYTHREAD_STORAGE
  if (storage === 'postgres') {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DAYTHREAD_STORAGE=postgres needs DATABASE_URL in the environment')
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
    // prepare: false so the same code runs on Supabase's transaction pooler. TLS for anything not on this machine,
    // unless the URL sets its own sslmode.
    const sql = postgres(url, { prepare: false, max: 4, onnotice: () => {}, ...(local || /[?&]sslmode=/.test(url) ? {} : { ssl: 'require' as const }) })
    return repository = new PostgresWorkspaceRepository(postgresClient(sql))
  }
  if (storage !== 'sqlite') throw new Error('Configure DAYTHREAD_STORAGE=sqlite or postgres. No fallback storage is enabled.')
  if (process.env.VERCEL || process.env.NETLIFY) throw new Error('Unauthenticated local SQLite storage is disabled on hosting platforms')
  return repository = new SqliteWorkspaceRepository(resolve(process.env.DAYTHREAD_SQLITE_PATH ?? '.daythread-local/workspace.sqlite'),resolve(process.env.DAYTHREAD_LOCAL_DATA_PATH ?? '.daythread-local/workspace.json'),{allowMissingLegacy:process.env.DAYTHREAD_LOCAL_DATA_PATH === undefined})
}
