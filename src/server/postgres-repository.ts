// The workspace on Postgres (Supabase), the same shape the SQLite store keeps: one workspace document with its
// revision, receipts and undo copy, plus the model budget ledger beside it. Each command locks the row, applies the
// domain command and writes the result in one transaction, exactly as SqliteWorkspaceRepository does under
// BEGIN IMMEDIATE. Starts empty (Brian 2fc19345: no data migration).
import { DatabaseSync } from 'node:sqlite'
import { applyCommand, createEmptyWorkspace } from '../domain/workspace.ts'
import type { Command, CommandResult, Workspace } from '../domain/types.ts'
import type { ServerRepository } from './repository.ts'
import type { SqlClient } from './db/sql.ts'
import { modelAttemptsTable } from './sqlite-mapping.ts'
import { markInterrupted, readAttempts, reconcileAttempt, reserveAttempt, type AttemptState, type ModelAttempt, type ReserveInput, type SettleInput } from './model-ledger.ts'
import { recordModelResult, type CommandOrBuild, type ModelResultOutcome } from './model-result.ts'
import { commandLogFields, debugLog } from './debug-log.ts'
import { currentOwner } from './auth/request-owner.ts'

type LedgerRow = Record<string, string | number | null>
interface Locked { workspace: Workspace; ledger: LedgerRow[] }

export function schemaName(value = process.env.DAYTHREAD_PG_SCHEMA ?? 'daythread'): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('DAYTHREAD_PG_SCHEMA must be a lowercase SQL identifier')
  return value
}

export class PostgresWorkspaceRepository implements ServerRepository {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly table: string
  constructor(sql: SqlClient, schema = schemaName()) { this.sql = sql; this.table = `${schema}.workspace` }

  /**
   * Once per process. Not in `public`: Supabase's Data API serves `public` to the publishable key. Row-level security
   * is on with no policies, so the API roles see nothing even if the schema is ever exposed; the server connects as
   * the table's owner, which RLS doesn't restrict.
   *
   * The schema is changed only when something is missing, checked with a plain catalog query and re-checked under the
   * setup lock: ALTER TABLE takes an exclusive lock, so running it on every cold start stalls the other instances.
   *
   * `user_id` links the workspace to his account (Brian 9985cf62, Lead): nullable, so an older build's start-up
   * insert still works after a rollback, and a trigger refuses changing it once set, unless an admin sets
   * `daythread.allow_relink` for that one transaction (credentials.md).
   */
  private init(): Promise<void> {
    const [schema, name] = this.table.split('.') as [string, string]
    const complete = async (sql: SqlClient) => (await sql.query<{ ok: boolean }>(
      `select exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and c.relname = $2 and c.relrowsecurity)
        and exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and c.relname = $2 and t.tgname = 'workspace_user_id_guard') as ok`, [schema, name]))[0]?.ok === true
    this.ready ??= complete(this.sql).then(async ok => {
      if (!ok) await this.sql.transaction(async tx => {
        await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
        if (await complete(tx)) return
        await tx.exec(`create schema if not exists ${schema};
          create table if not exists ${this.table} (
            id integer primary key check (id = 1),
            revision integer not null,
            data json not null,
            ledger json not null default '[]',
            updated_at timestamptz not null default now()
          );
          alter table ${this.table} enable row level security;
          alter table ${this.table} add column if not exists user_id uuid unique;
          create or replace function ${schema}.workspace_user_id_guard() returns trigger language plpgsql as $guard$
          begin
            if old.user_id is not null and new.user_id is distinct from old.user_id
               and coalesce(current_setting('daythread.allow_relink', true), '') <> 'on' then
              raise exception 'The workspace''s account link can''t be changed (see credentials.md)';
            end if;
            return new;
          end $guard$;
          drop trigger if exists workspace_user_id_guard on ${this.table};
          create trigger workspace_user_id_guard before update of user_id on ${this.table}
            for each row execute function ${schema}.workspace_user_id_guard();
          -- Supabase: the account must exist, and can't be deleted while linked. Skipped where there's no auth.users.
          do $fk$ begin
            if to_regclass('auth.users') is not null and not exists (select 1 from pg_catalog.pg_constraint
                where conname = 'workspace_user_id_fkey' and conrelid = '${this.table}'::regclass) then
              alter table ${this.table} add constraint workspace_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict;
            end if;
          end $fk$;`)
      })
      await this.sql.query(`insert into ${this.table} (id, revision, data) values (1, 0, $1::text::json) on conflict (id) do nothing`, [JSON.stringify(createEmptyWorkspace())])
      const [{ n }] = await this.sql.query<{ n: number }>(`select count(*)::int as n from ${this.table}`) as [{ n: number }]
      if (n !== 1) throw new Error(`Expected one workspace row in ${this.table}, found ${n}; not starting`)
    }).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  /** Ready to use: the gate checks sessions against the workspace row, so it must exist first. */
  prepare(): Promise<void> { return this.init() }

  /**
   * Links the workspace to the account that just signed in with the owner's password, inside the sign-in
   * transaction: unlinked → linked to it; linked to it → fine; linked to another account → 'not-linked'. Touches
   * nothing but `user_id`, so the document, its revision and the ledger are unchanged.
   */
  async link(tx: SqlClient, userId: string): Promise<'linked' | 'not-linked'> {
    await this.init()
    const [row] = await tx.query<{ user_id: string | null }>(`select user_id::text as user_id from ${this.table} where id = 1 for update`)
    if (!row) throw new Error('Workspace missing')
    if (row.user_id === userId) return 'linked'
    if (row.user_id !== null) return 'not-linked'
    await tx.query(`update ${this.table} set user_id = $1::uuid where id = 1`, [userId])
    return 'linked'
  }

  /** `json`, not `jsonb`: stored as written, and it accepts every string he can type (jsonb refuses \u0000). */
  /** With a signed-in owner, only the row linked to that account; with sign-in off, the one row. */
  private async read(tx: SqlClient, lock: boolean): Promise<Locked> {
    const owner = currentOwner()
    const [row] = await tx.query<{ data: string; ledger: string }>(
      `select data::text as data, ledger::text as ledger from ${this.table} where id = 1${owner ? ' and user_id = $1::uuid' : ''}${lock ? ' for update' : ''}`, owner ? [owner] : [])
    if (!row) throw new Error(owner ? 'Workspace not linked to this account' : 'Workspace missing')
    return { workspace: JSON.parse(row.data) as Workspace, ledger: JSON.parse(row.ledger) as LedgerRow[] }
  }
  // `$n::text::json`: postgres-js serializes a parameter it's told is json with JSON.stringify, so a json-typed
  // parameter would store the document as one JSON string. Sent as text, it's stored as the document itself.
  private async writeWorkspace(tx: SqlClient, workspace: Workspace): Promise<void> {
    await tx.query(`update ${this.table} set revision = $1, data = $2::text::json, updated_at = now() where id = 1`, [workspace.revision, JSON.stringify(workspace)])
  }
  private async writeLedger(tx: SqlClient, ledger: LedgerRow[]): Promise<void> {
    await tx.query(`update ${this.table} set ledger = $1::text::json where id = 1`, [JSON.stringify(ledger)])
  }

  /** Runs `fn` with the row locked; nothing it wrote survives an error. */
  private async locked<T>(fn: (tx: SqlClient, current: Locked) => Promise<T>): Promise<T> {
    await this.init()
    return this.sql.transaction(async tx => fn(tx, await this.read(tx, true)))
  }
  /**
   * The ledger rules (model-ledger.ts) are written against SQLite. They run unchanged on an in-memory copy of the
   * ledger rows, which is written back in the same transaction when it changed. Rows keep integer micro-USD, so
   * nothing is rounded on the way through.
   */
  private async withLedger<T>(fn: (ledger: DatabaseSync, tx: SqlClient, current: Locked) => Promise<T> | T): Promise<T> {
    return this.locked(async (tx, current) => {
      const ledger = new DatabaseSync(':memory:')
      try {
        ledger.exec(modelAttemptsTable)
        for (const row of current.ledger) {
          const columns = Object.keys(row)
          ledger.prepare(`INSERT INTO model_attempts (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(c => row[c]!))
        }
        const value = await fn(ledger, tx, current)
        const after = ledger.prepare('SELECT * FROM model_attempts ORDER BY createdAt, id').all() as LedgerRow[]
        if (JSON.stringify(after) !== JSON.stringify(current.ledger)) await this.writeLedger(tx, after)
        return value
      } finally { ledger.close() }
    })
  }

  async load(): Promise<Workspace> {
    await this.init()
    return (await this.read(this.sql, false)).workspace
  }
  async execute(command: Command): Promise<CommandResult> {
    const started = performance.now(), fields = commandLogFields(command)
    debugLog('command.start', fields)
    try {
      const { result, before } = await this.locked(async (tx, { workspace: current }) => {
        const result = applyCommand(current, command)
        if (result.workspace.revision !== current.revision) await this.writeWorkspace(tx, result.workspace)
        return { result, before: current.revision }
      })
      debugLog('command.finish', { ...fields, beforeRevision: before, afterRevision: result.workspace.revision, elapsedMs: performance.now() - started, result: result.workspace.revision === before ? 'replay' : 'committed' })
      return result
    } catch (error) {
      debugLog('command.finish', { ...fields, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' })
      throw error
    }
  }
  /** A server-only command applied to the workspace as it is now: background work isn't refused because he typed meanwhile. */
  async executeOnLatest(operationId: string, action: Command['action']): Promise<CommandResult> {
    return this.locked(async (tx, { workspace: current }) => {
      const result = applyCommand(current, { operationId, expectedRevision: current.revision, action })
      if (result.workspace.revision !== current.revision) await this.writeWorkspace(tx, result.workspace)
      return result
    })
  }

  async modelAttempts(): Promise<ModelAttempt[]> { return this.withLedger(readAttempts) }
  async reserveModelAttempt(input: ReserveInput): Promise<{ attempt: ModelAttempt; replayed: boolean }> { return this.withLedger(ledger => reserveAttempt(ledger, input)) }
  async markInterruptedModelAttempts(now: string, olderThan?: string): Promise<number> { return this.withLedger(ledger => markInterrupted(ledger, now, olderThan)) }
  async reconcileModelAttempt(attemptId: string, amount: number | 'worst-case', now: string, note?: string, from?: readonly AttemptState[]): Promise<ModelAttempt> {
    return this.withLedger(ledger => reconcileAttempt(ledger, attemptId, amount, now, note, from))
  }
  async recordModelResult(input: SettleInput, commandOrBuild?: CommandOrBuild, options: { failAfterWrite?: boolean } = {}): Promise<ModelResultOutcome> {
    return this.withLedger(async (ledger, tx, current) => {
      let workspace = current.workspace, written: Workspace | undefined
      const outcome = recordModelResult(ledger, { read: () => workspace, write: (_before, after) => { workspace = written = after } }, input, commandOrBuild, options)
      if (written) await this.writeWorkspace(tx, written)
      return outcome
    })
  }
}
