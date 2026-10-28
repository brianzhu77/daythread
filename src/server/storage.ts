import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'
import postgres, { type Sql } from 'postgres'
import type { ServerRepository } from './repository.ts'
import { SqliteWorkspaceRepository } from './sqlite-repository.ts'
import { PostgresWorkspaceRepository } from './postgres-repository.ts'
import { postgresClient, type SqlClient } from './db/sql.ts'
import { onHostingPlatform, onWorkers } from './hosting.ts'
let repository: ServerRepository | undefined
let client: SqlClient | undefined
/**
 * DAYTHREAD_STORAGE picks the store: `postgres` (DATABASE_URL must be set in the environment) or `sqlite`. On a
 * hosting platform it defaults to `postgres`, so a deployment needs no extra setting.
 */
export function storageKind(): string | undefined {
  return process.env.DAYTHREAD_STORAGE ?? (onHostingPlatform() ? 'postgres' : undefined)
}
/**
 * The one Postgres client of this process (workspace and sign-in sessions alike); Postgres storage only. On a Worker a
 * socket belongs to the request that opened it, so there the client opens one connection per request instead of a
 * shared pool: `withRequestDatabase` (the gate) scopes it, and every query in that request goes through it.
 */
export function postgresSql(): SqlClient {
  if (client) return client
  if (storageKind() !== 'postgres') throw new Error('Needs DAYTHREAD_STORAGE=postgres')
  return client = onWorkers() ? requestScopedClient() : postgresClient(connect(4))
}
function connect(max: number, hyperdrive?: string): Sql {
  // Through Hyperdrive (a Worker with the binding), Cloudflare holds the TLS connection to Supabase and pools it; the
  // Worker's own hop is local, so no TLS here, and no type lookup on every new connection.
  if (hyperdrive) return postgres(hyperdrive, { prepare: false, max, fetch_types: false, onnotice: () => {} })
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DAYTHREAD_STORAGE=postgres needs DATABASE_URL in the environment')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  // prepare: false so the same code runs on Supabase's transaction pooler. TLS for anything not on this machine,
  // unless the URL sets its own sslmode.
  return postgres(url, { prepare: false, max, onnotice: () => {}, ...(local || /[?&]sslmode=/.test(url) ? {} : { ssl: 'require' as const }) })
}

type RequestScope = { sql?: Sql; hyperdrive?: string }
const requestDatabase = new AsyncLocalStorage<RequestScope>()
/** Runs one request with its own database connection (opened on first query), closed once the request is answered. */
export async function withRequestDatabase<T>(fn: () => Promise<T>): Promise<T> {
  if (!onWorkers()) return fn()
  const scope: RequestScope = { hyperdrive: await hyperdriveUrl() }
  try {
    return await requestDatabase.run(scope, fn)
  } finally {
    const sql = scope.sql
    scope.sql = undefined
    // Waits for queries still running (a streamed page), then closes; nothing to wait for if nothing was asked.
    if (sql) void sql.end({ timeout: 5 }).catch(() => undefined)
  }
}
/**
 * The Worker's Hyperdrive connection string, when the deploy bound one (`HYPERDRIVE`). Supabase's certificate isn't
 * one the Workers runtime accepts, so in production the database is only reachable through Hyperdrive; without the
 * binding (wrangler dev on the Mac) DATABASE_URL is used as is. The specifier is a variable so no other build tries
 * to resolve the Workers-only module.
 */
let hyperdrive: Promise<string | undefined> | undefined
function hyperdriveUrl(): Promise<string | undefined> {
  const workers = 'cloudflare:workers'
  return hyperdrive ??= (import(/* @vite-ignore */ workers) as Promise<{ env: { HYPERDRIVE?: { connectionString: string } } }>)
    .then(({ env }) => env.HYPERDRIVE?.connectionString)
}
function requestScopedClient(): SqlClient {
  const current = (): SqlClient => {
    const scope = requestDatabase.getStore()
    if (!scope) throw new Error('A database query outside a request (withRequestDatabase) on a Worker')
    return postgresClient(scope.sql ??= connect(1, scope.hyperdrive))
  }
  return {
    exec: text => current().exec(text),
    query: (text, params) => current().query(text, params),
    transaction: fn => current().transaction(fn),
  } as SqlClient
}
export function getRepository(): ServerRepository {
  if (repository) return repository
  const storage = storageKind()
  if (storage === 'postgres') return repository = new PostgresWorkspaceRepository(postgresSql())
  if (storage !== 'sqlite') throw new Error('Configure DAYTHREAD_STORAGE=sqlite or postgres. No fallback storage is enabled.')
  if (onHostingPlatform()) throw new Error('Unauthenticated local SQLite storage is disabled on hosting platforms')
  return repository = new SqliteWorkspaceRepository(resolve(process.env.DAYTHREAD_SQLITE_PATH ?? '.daythread-local/workspace.sqlite'), resolve(process.env.DAYTHREAD_LOCAL_DATA_PATH ?? '.daythread-local/workspace.json'), { allowMissingLegacy: process.env.DAYTHREAD_LOCAL_DATA_PATH === undefined })
}
