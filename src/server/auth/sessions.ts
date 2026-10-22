// The server's own sign-in sessions: an opaque random token in an httpOnly cookie, kept here only as its SHA-256.
// Signing out deletes the row, so an old tab or a copied cookie is refused on its next request (Ratchet f6dc9688).
// Sliding 30 days, renewed at most once an hour by any request that passes the gate, never past 180 days from sign-in
// (Bumblebee 869d3f42, Ratchet d1ec5845). Same schema as the workspace, RLS on with no policies.
import { createHash, randomBytes } from 'node:crypto'
import type { SqlClient } from '../db/sql.ts'
import { schemaName } from '../postgres-repository.ts'

export const slidingMs = 30 * 24 * 3600_000
export const absoluteMs = 180 * 24 * 3600_000
export const renewEveryMs = 3600_000
export const failureWindowMs = 15 * 60_000
export const freeFailures = 5
export const maxWaitMs = 15 * 60_000

export interface Session { email: string; userId: string; expiresAt: Date }
/** `linkedUserId`: the account the workspace is linked to, read in the same query (null when not linked). */
export interface CheckedSession extends Session { renewed: boolean; linkedUserId: string | null }
/** A sign-in try: the password failed, it passed, or it passed but can't be used (not linked): counted neither way. */
export type Outcome = 'ok' | 'fail' | 'neutral'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const isToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token)

export class SessionStore {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly table: string
  private readonly failures: string
  private readonly workspace: string | undefined
  /** `workspace`: the workspace table whose link every check reads; omitted, sessions stand alone (tests). */
  constructor(sql: SqlClient, schema = schemaName(), options: { workspace?: string } = {}) {
    this.sql = sql; this.table = `${schema}.sessions`; this.failures = `${schema}.sign_in_failures`; this.workspace = options.workspace
  }

  /**
   * Once per process. The tables are created only if missing, re-checked under the lock: ALTER TABLE takes an
   * exclusive lock, so running it on every cold start would stall, or deadlock with, sign-ins on other instances.
   */
  private init(): Promise<void> {
    // A plain catalog query, not to_regclass: an advisory lock doesn't refresh the catalog cache that to_regclass
    // reads, so after waiting for another instance's setup it could still report the tables missing.
    const [schema, sessions] = this.table.split('.'), failures = this.failures.split('.')[1]
    const exists = async (sql: SqlClient) => (await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = any($2::text[]) and c.relrowsecurity`, [schema, [sessions, failures]]))[0]?.n === 2
    this.ready ??= exists(this.sql).then(ok => ok ? undefined : this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
      if (await exists(tx)) return
      await tx.exec(`create schema if not exists ${schema};
        create table if not exists ${this.table} (
          token_hash text primary key,
          user_id text not null,
          email text not null,
          created_at timestamptz not null,
          renewed_at timestamptz not null,
          expires_at timestamptz not null
        );
        create index if not exists sessions_expires_at on ${this.table} (expires_at);
        alter table ${this.table} enable row level security;
        create table if not exists ${this.failures} (at timestamptz not null);
        create index if not exists sign_in_failures_at on ${this.failures} (at);
        alter table ${this.failures} enable row level security;`)
    }))
    return this.ready
  }

  /** A new session for a verified owner; returns the token for the cookie (shown nowhere else). `tx`: inside a sign-in. */
  async create(userId: string, email: string, now = new Date(), tx: SqlClient = this.sql): Promise<{ token: string; expiresAt: Date }> {
    await this.init()
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now.getTime() + slidingMs)
    await tx.query(`insert into ${this.table} (token_hash, user_id, email, created_at, renewed_at, expires_at) values ($1, $2, $3, $4, $4, $5)`,
      [hash(token), userId, email, now.toISOString(), expiresAt.toISOString()])
    await tx.query(`delete from ${this.table} where expires_at < $1`, [now.toISOString()])
    return { token, expiresAt }
  }

  /** The live session for a cookie token, renewed when its last renewal is over an hour old; null otherwise. */
  async check(token: string | undefined, now = new Date()): Promise<CheckedSession | null> {
    if (!token || !isToken(token)) return null
    await this.init()
    const [row] = await this.sql.query<{ email: string; user_id: string; linked: string | null; created_at: string | Date; renewed_at: string | Date; expires_at: string | Date }>(
      `select email, user_id, ${this.workspace ? `(select user_id::text from ${this.workspace} where id = 1)` : 'null::text'} as linked,
        created_at, renewed_at, expires_at from ${this.table} where token_hash = $1`, [hash(token)])
    if (!row || new Date(row.expires_at).getTime() <= now.getTime()) return null
    const createdAt = new Date(row.created_at), expiresAt = new Date(row.expires_at)
    const session = { email: row.email, userId: row.user_id, linkedUserId: row.linked }
    if (now.getTime() - new Date(row.renewed_at).getTime() < renewEveryMs) return { ...session, expiresAt, renewed: false }
    const next = new Date(Math.min(now.getTime() + slidingMs, createdAt.getTime() + absoluteMs))
    await this.sql.query(`update ${this.table} set renewed_at = $2, expires_at = $3 where token_hash = $1`, [hash(token), now.toISOString(), next.toISOString()])
    return { ...session, expiresAt: next, renewed: true }
  }

  async delete(token: string | undefined): Promise<void> {
    if (!token || !isToken(token)) return
    await this.init()
    await this.sql.query(`delete from ${this.table} where token_hash = $1`, [hash(token)])
  }

  /**
   * One sign-in try against the failures of every instance and address (Lead 48163c61). Tries run one at a time under
   * a transaction lock, so simultaneous requests can't all read the old count and get through (Ratchet). After
   * `freeFailures` in the window, each further try waits 30 s, doubling per failure, up to 15 min after the last
   * failure; a refused try records nothing, so it never pushes the wait out. A success clears the count; a
   * 'neutral' outcome (right password, workspace linked to another account) does neither (Bumblebee fb275f23). Only
   * new sign-ins wait: existing sessions are never touched (Bumblebee 2cef8a00). `verify` runs in the same
   * transaction, so whatever it writes (the link, the new session) commits or rolls back with the try.
   */
  async attempt(verify: (tx: SqlClient) => Promise<Outcome>, now = () => new Date()): Promise<{ outcome: Outcome; waitMs: number }> {
    await this.init()
    return this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.sign-in'))")
      const at = now()
      const [row] = await tx.query<{ n: number; last: string | Date | null }>(
        `select count(*)::int as n, max(at) as last from ${this.failures} where at > $1`, [new Date(at.getTime() - failureWindowMs).toISOString()])
      const waitMs = row && row.n >= freeFailures && row.last ? Math.max(0, new Date(row.last).getTime() + Math.min(30_000 * 2 ** (row.n - freeFailures), maxWaitMs) - at.getTime()) : 0
      if (waitMs > 0) return { outcome: 'fail' as const, waitMs }
      const outcome = await verify(tx)
      if (outcome === 'ok') await tx.query(`delete from ${this.failures}`)
      if (outcome === 'fail') {
        await tx.query(`insert into ${this.failures} (at) values ($1)`, [at.toISOString()])
        await tx.query(`delete from ${this.failures} where at < $1`, [new Date(at.getTime() - failureWindowMs).toISOString()])
      }
      return { outcome, waitMs: 0 }
    })
  }
}
