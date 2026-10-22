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

export interface Session { email: string; expiresAt: Date }
export interface CheckedSession extends Session { renewed: boolean }

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const isToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token)

export class SessionStore {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly table: string
  constructor(sql: SqlClient, schema = schemaName()) { this.sql = sql; this.table = `${schema}.sessions` }

  private init(): Promise<void> {
    this.ready ??= this.sql.transaction(async tx => {
      const schema = this.table.split('.')[0]!
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
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
        alter table ${this.table} enable row level security;`)
    })
    return this.ready
  }

  /** A new session for a verified owner; returns the token for the cookie (shown nowhere else). */
  async create(userId: string, email: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    await this.init()
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now.getTime() + slidingMs)
    await this.sql.query(`insert into ${this.table} (token_hash, user_id, email, created_at, renewed_at, expires_at) values ($1, $2, $3, $4, $4, $5)`,
      [hash(token), userId, email, now.toISOString(), expiresAt.toISOString()])
    await this.sql.query(`delete from ${this.table} where expires_at < $1`, [now.toISOString()])
    return { token, expiresAt }
  }

  /** The live session for a cookie token, renewed when its last renewal is over an hour old; null otherwise. */
  async check(token: string | undefined, now = new Date()): Promise<CheckedSession | null> {
    if (!token || !isToken(token)) return null
    await this.init()
    const [row] = await this.sql.query<{ email: string; created_at: string | Date; renewed_at: string | Date; expires_at: string | Date }>(
      `select email, created_at, renewed_at, expires_at from ${this.table} where token_hash = $1`, [hash(token)])
    if (!row || new Date(row.expires_at).getTime() <= now.getTime()) return null
    const createdAt = new Date(row.created_at), expiresAt = new Date(row.expires_at)
    if (now.getTime() - new Date(row.renewed_at).getTime() < renewEveryMs) return { email: row.email, expiresAt, renewed: false }
    const next = new Date(Math.min(now.getTime() + slidingMs, createdAt.getTime() + absoluteMs))
    await this.sql.query(`update ${this.table} set renewed_at = $2, expires_at = $3 where token_hash = $1`, [hash(token), now.toISOString(), next.toISOString()])
    return { email: row.email, expiresAt: next, renewed: true }
  }

  async delete(token: string | undefined): Promise<void> {
    if (!token || !isToken(token)) return
    await this.init()
    await this.sql.query(`delete from ${this.table} where token_hash = $1`, [hash(token)])
  }
}
