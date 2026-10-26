// Accounts and the invite list (shot 2). An account is a Supabase login that has signed in here at least once: its
// address for "{email} · Sign out", beside its workspace (postgres-repository.ts). The invite list is who may come in
// while DAYTHREAD_SIGNUP=invite: rows in `invites`, plus DAYTHREAD_INVITES from the environment. Same schema as the
// workspace, RLS on with no policies.
import type { SqlClient } from '../db/sql.ts'
import { schemaName } from '../postgres-repository.ts'
import { normalizeEmail } from './config.ts'

export interface Account { userId: string; email: string }

export class AccountStore {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly accounts: string
  private readonly invites: string
  constructor(sql: SqlClient, schema = schemaName()) { this.sql = sql; this.accounts = `${schema}.accounts`; this.invites = `${schema}.invites` }

  private init(): Promise<void> {
    const [schema, accounts] = this.accounts.split('.'), invites = this.invites.split('.')[1]
    const exists = async (sql: SqlClient) => (await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = any($2::text[]) and c.relrowsecurity`, [schema, [accounts, invites]]))[0]?.n === 2
    this.ready ??= exists(this.sql).then(ok => ok ? undefined : this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
      if (await exists(tx)) return
      await tx.exec(`create schema if not exists ${schema};
        create table if not exists ${this.accounts} (
          user_id uuid primary key,
          email text not null unique,
          created_at timestamptz not null default now()
        );
        alter table ${this.accounts} enable row level security;
        create table if not exists ${this.invites} (
          email text primary key,
          created_at timestamptz not null default now(),
          used_at timestamptz
        );
        alter table ${this.invites} enable row level security;`)
    })).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  prepare(): Promise<void> { return this.init() }

  /** Whether the address may come in: on the list in the database or in the environment. */
  async invited(email: string, envInvites: readonly string[] = [], sql: SqlClient = this.sql): Promise<boolean> {
    await this.init()
    const address = normalizeEmail(email)
    if (envInvites.some(e => normalizeEmail(e) === address)) return true
    return (await sql.query<{ n: number }>(`select count(*)::int as n from ${this.invites} where email = $1`, [address]))[0]?.n === 1
  }
  /** Adds an address to the list (an admin's call, or a test's). */
  async invite(email: string): Promise<void> {
    await this.init()
    await this.sql.query(`insert into ${this.invites} (email) values ($1) on conflict (email) do nothing`, [normalizeEmail(email)])
  }
  async account(userId: string, sql: SqlClient = this.sql): Promise<Account | null> {
    await this.init()
    const [row] = await sql.query<{ user_id: string; email: string }>(`select user_id::text as user_id, email from ${this.accounts} where user_id = $1::uuid`, [userId])
    return row ? { userId: row.user_id, email: row.email } : null
  }
  /** The account row for a login that just came in, made once; its invite, if any, is marked used. */
  async ensureAccount(tx: SqlClient, userId: string, email: string): Promise<Account> {
    await this.init()
    const address = normalizeEmail(email)
    await tx.query(`insert into ${this.accounts} (user_id, email) values ($1::uuid, $2) on conflict (user_id) do update set email = excluded.email`, [userId, address])
    await tx.query(`update ${this.invites} set used_at = now() where email = $1 and used_at is null`, [address])
    return { userId, email: address }
  }
  async deleteAccount(tx: SqlClient, userId: string): Promise<void> {
    await this.init()
    await tx.query(`delete from ${this.accounts} where user_id = $1::uuid`, [userId])
  }
}
