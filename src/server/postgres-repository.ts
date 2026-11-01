// The workspace on Postgres (Supabase) as rows, one workspace per account (shot 2): `workspaces`, `pages`, `tasks`,
// `deleted_tasks` and `operations`, every row carrying its workspace id. A command locks the workspace row, applies
// the domain command and writes only the rows that changed, in one transaction; the operation's receipt (for replay)
// and the rows as they were (its inverse, for Undo) go to `operations`. Shot 1's single row is migrated on first start.
import { applyCommand, createEmptyWorkspace } from '../domain/workspace.ts'
import { upgradeWorkspace } from '../domain/convert-v1.ts'
import type { Command, CommandResult, Receipt, Workspace } from '../domain/types.ts'
import { todayIn, type ServerRepository } from './repository.ts'
import type { SqlClient } from './db/sql.ts'
import { commandLogFields, debugLog } from './debug-log.ts'
import { currentOwner } from './auth/request-owner.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf, type DeletedRow, type PageRow, type RowDiff, type Rows, type TaskRow } from './workspace-rows.ts'

export function schemaName(value = process.env.DAYTHREAD_PG_SCHEMA ?? 'daythread'): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('DAYTHREAD_PG_SCHEMA must be a lowercase SQL identifier')
  return value
}

export interface WorkspaceInfo { id: string; timezone: string; revision: number }

/** An operation is kept this long for replay (a lost response needs seconds; this is generous); the newest is always kept, it carries the Undo marker. */
export const operationKeepMs = 30 * 24 * 3600_000
/** The log is pruned inside the write transaction every this many revisions: no scheduler, no noticeable cost. */
export const pruneEvery = 25
interface Scope extends WorkspaceInfo { userId: string | null }

const pageColumns = ['id', 'position', 'type', 'date', 'title', 'url', 'parent_id', 'trashed_at', 'trash_id', 'document', 'handoff_done', 'review_saved', 'database_json', 'row_values', 'created_at', 'edited_at'] as const
/** Columns added to `pages` after its first release (databases): added on start when missing, before any build writes them. */
const addedPageColumns = ['database_json', 'row_values', 'created_at', 'edited_at'] as const
const taskColumns = ['id', 'position', 'title', 'status', 'version', 'paused', 'deadline_on', 'attention_on', 'created_on', 'source_page_id', 'done_on'] as const
const deletedColumns = ['id', 'position', 'data'] as const

export class PostgresWorkspaceRepository implements ServerRepository {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly schema: string
  private readonly today: string
  constructor(sql: SqlClient, schema = schemaName(), options: { today?: string } = {}) { this.sql = sql; this.schema = schema; this.today = options.today ?? todayIn() }
  private t(name: string): string { return `${this.schema}.${name}` }

  /**
   * Once per process. Not in `public`: Supabase's Data API serves `public` to the publishable key. Row-level security
   * is on with no policies, so the API roles see nothing even if the schema is ever exposed; the server connects as
   * the tables' owner, which RLS doesn't restrict, and scopes every statement by workspace id itself.
   *
   * The schema is changed only when something is missing, checked with a plain catalog query and re-checked under
   * the setup lock, so cold starts don't stall each other. Shot 1's `workspace` table, when present, is migrated and
   * renamed `workspace_shot1` (the rollback copy) in the same transaction.
   */
  private init(): Promise<void> {
    const tables = async (sql: SqlClient) => (await sql.query<{ relname: string }>(
      `select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r' and c.relrowsecurity`, [this.schema])).map(r => r.relname)
    const pageColumnsHave = async (sql: SqlClient) => (await sql.query<{ attname: string }>(
      `select a.attname from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = 'pages' and a.attnum > 0 and not a.attisdropped`, [this.schema])).map(r => r.attname)
    const complete = async (sql: SqlClient) => {
      const have = await tables(sql)
      if (!['workspaces', 'pages', 'tasks', 'deleted_tasks', 'operations'].every(t => have.includes(t)) || have.includes('workspace')) return false
      const columns = await pageColumnsHave(sql)
      return addedPageColumns.every(c => columns.includes(c))
    }
    this.ready ??= complete(this.sql).then(async ok => {
      if (ok) return
      await this.sql.transaction(async tx => {
        await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
        if (await complete(tx)) return
        const s = this.schema
        await tx.exec(`create schema if not exists ${s};
          create table if not exists ${s}.workspaces (
            id uuid primary key default gen_random_uuid(),
            user_id uuid unique,
            revision integer not null default 0,
            timezone text not null,
            created_at timestamptz not null default now()
          );
          create unique index if not exists workspaces_local on ${s}.workspaces ((user_id is null)) where user_id is null;
          alter table ${s}.workspaces enable row level security;
          create table if not exists ${s}.pages (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            id text not null, position double precision not null, type text not null, date text, title text not null, url text,
            parent_id text, trashed_at text, trash_id text, document text not null,
            handoff_done boolean not null default false, review_saved boolean not null default false,
            primary key (workspace_id, id)
          );
          alter table ${s}.pages enable row level security;
          create table if not exists ${s}.tasks (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            id text not null, position double precision not null, title text not null, status text not null, version integer not null,
            paused boolean not null, deadline_on text, attention_on text, created_on text not null, source_page_id text not null, done_on text,
            primary key (workspace_id, id)
          );
          alter table ${s}.tasks enable row level security;
          create table if not exists ${s}.deleted_tasks (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            id text not null, position double precision not null, data json not null,
            primary key (workspace_id, id)
          );
          alter table ${s}.deleted_tasks enable row level security;
          create table if not exists ${s}.operations (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            operation_id text not null, revision integer not null, type text not null, receipt json not null, inverse json,
            created_at timestamptz not null default now(),
            primary key (workspace_id, operation_id)
          );
          create index if not exists operations_revision on ${s}.operations (workspace_id, revision desc);
          create index if not exists operations_created on ${s}.operations (workspace_id, created_at);
          alter table ${s}.operations enable row level security;
          ${addedPageColumns.map(c => `alter table ${s}.pages add column if not exists ${c} text;`).join('\n          ')}`)
        if ((await tables(tx)).includes('workspace')) await this.migrateShot1(tx)
      })
    }).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  /**
   * Shot 1's one row becomes its account's workspace (or the local one when unlinked); a never-written row becomes nothing.
   * Only once: when `workspace_shot1` is already there, the cutover happened and this `workspace` table came from an
   * old build run against the database afterwards (Brian, Oct 26: every sign-in failed on "workspace_shot1 already
   * exists"). It is kept aside under a dated name, never migrated over the live rows, and the start goes on.
   */
  private async migrateShot1(tx: SqlClient): Promise<void> {
    const [already] = await tx.query<{ n: number }>(`select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = 'workspace_shot1'`, [this.schema])
    if (already?.n) {
      const taken = async (name: string) => (await tx.query<{ n: number }>(`select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`, [this.schema, name]))[0]!.n > 0
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
      let stray = `workspace_stray_${stamp}`
      for (let i = 2; await taken(stray); i++) stray = `workspace_stray_${stamp}_${i}`
      const [row] = await tx.query<{ revision: number; user_id: string | null; updated_at: string }>(`select revision, user_id::text as user_id, updated_at::text as updated_at from ${this.t('workspace')} where id = 1`)
      console.warn(JSON.stringify({ level: 'warn', event: 'storage.stray-shot1-table', renamedTo: stray, row: row ?? null }))
      await tx.exec(`alter table ${this.t('workspace')} rename to ${stray}`)
      return
    }
    const [row] = await tx.query<{ data: string; revision: number; user_id: string | null }>(`select data::text as data, revision, user_id::text as user_id from ${this.t('workspace')} where id = 1`)
    if (row) {
      const ws = upgradeWorkspace(JSON.parse(row.data), this.today)
      if (row.user_id !== null || ws.revision > 0 || ws.pages.length || ws.tasks.length) {
        const id = await this.createWorkspaceIn(tx, row.user_id, ws.timezone)
        const rows = rowsOf(ws)
        await tx.query(`update ${this.t('workspaces')} set revision = $2 where id = $1::uuid`, [id, ws.revision])
        await this.writeDiff(tx, id, { pages: { upsert: rows.pages, remove: [] }, tasks: { upsert: rows.tasks, remove: [] }, deleted: { upsert: rows.deleted, remove: [] } })
        for (const r of Object.values(ws.receipts)) await this.writeOperation(tx, id, r, 0, 'migrated', null)
        console.info(JSON.stringify({ level: 'info', event: 'storage.migrate-shot1', revision: ws.revision, pages: ws.pages.length, linked: row.user_id !== null }))
      }
    }
    await tx.exec(`alter table ${this.t('workspace')} rename to workspace_shot1`)
  }
  prepare(): Promise<void> { return this.init() }

  // ---------------------------------------------------------------- accounts and their workspaces

  async workspaceOf(userId: string, sql: SqlClient = this.sql): Promise<WorkspaceInfo | null> {
    await this.init()
    const [row] = await sql.query<WorkspaceInfo>(`select id::text as id, timezone, revision from ${this.t('workspaces')} where user_id = $1::uuid`, [userId])
    return row ?? null
  }
  async timezoneOf(userId: string): Promise<string | null> { return (await this.workspaceOf(userId))?.timezone ?? null }
  /** The account's workspace, made now if it has none (`userId` null: the local workspace with sign-in off). Returns its id. */
  async createWorkspace(tx: SqlClient, userId: string | null, timezone: string): Promise<string> {
    await this.init()
    return this.createWorkspaceIn(tx, userId, timezone)
  }
  private async createWorkspaceIn(tx: SqlClient, userId: string | null, timezone: string): Promise<string> {
    const where = userId === null ? 'user_id is null' : 'user_id = $1::uuid', params = userId === null ? [] : [userId]
    const found = await tx.query<{ id: string }>(`select id::text as id from ${this.t('workspaces')} where ${where}`, params)
    if (found[0]) return found[0].id
    const fresh = createEmptyWorkspace(timezone)
    await tx.query(`insert into ${this.t('workspaces')} (user_id, timezone) values ($1::uuid, $2) on conflict do nothing`, [userId, fresh.timezone])
    const [row] = await tx.query<{ id: string }>(`select id::text as id from ${this.t('workspaces')} where ${where}`, params)
    if (!row) throw new Error('Workspace not created')
    return row.id
  }
  /** The workspace an account works in (null: this machine's, with sign-in off), made now if it has none. Returns its id. */
  async workspaceIdFor(userId: string | null): Promise<string> {
    await this.init()
    return this.sql.transaction(tx => this.createWorkspaceIn(tx, userId, 'America/Vancouver'))
  }
  /** One workspace by id, for background work on every account (reminders): no owner scope, no Undo marker. */
  async loadWorkspace(id: string): Promise<Workspace | null> {
    await this.init()
    const [info] = await this.sql.query<WorkspaceInfo>(`select id::text as id, timezone, revision from ${this.t('workspaces')} where id = $1::uuid`, [id])
    return info ? workspaceOf(await this.readRows(this.sql, { ...info, userId: null })) : null
  }
  /** Every row of the account's workspace goes (the tables cascade). */
  async deleteWorkspace(tx: SqlClient, userId: string): Promise<void> {
    await this.init()
    await tx.query(`delete from ${this.t('workspaces')} where user_id = $1::uuid`, [userId])
  }

  // ---------------------------------------------------------------- reading and writing the signed-in workspace

  /** The workspace this request works on: the signed-in account's, or the local one with sign-in off. */
  private async scope(tx: SqlClient, lock: boolean): Promise<Scope> {
    const owner = currentOwner() ?? null
    const forUpdate = lock ? ' for update' : ''
    if (owner === null) {
      const [local] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, revision from ${this.t('workspaces')} where user_id is null${forUpdate}`)
      if (local) return { ...local, userId: null }
      const id = await this.createWorkspaceIn(tx, null, 'America/Vancouver')
      const [made] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, revision from ${this.t('workspaces')} where id = $1::uuid${forUpdate}`, [id])
      return { ...made!, userId: null }
    }
    const [row] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, revision from ${this.t('workspaces')} where user_id = $1::uuid${forUpdate}`, [owner])
    if (!row) throw new Error('No workspace for this account')
    return { ...row, userId: owner }
  }
  private async readRows(tx: SqlClient, scope: Scope): Promise<Rows> {
    const [pages, tasks, deleted] = await Promise.all([
      tx.query<PageRow>(`select ${pageColumns.join(', ')} from ${this.t('pages')} where workspace_id = $1::uuid order by position`, [scope.id]),
      tx.query<TaskRow>(`select ${taskColumns.join(', ')} from ${this.t('tasks')} where workspace_id = $1::uuid order by position`, [scope.id]),
      tx.query<DeletedRow>(`select id, position, data::text as data from ${this.t('deleted_tasks')} where workspace_id = $1::uuid order by position`, [scope.id]),
    ])
    return { revision: scope.revision, timezone: scope.timezone, pages, tasks, deleted }
  }
  /** The Undo marker: the newest operation, when it has an inverse and nothing came after it. */
  private async undoMarker(tx: SqlClient, scope: Scope): Promise<Workspace['undo']> {
    const [op] = await tx.query<{ operation_id: string }>(`select operation_id from ${this.t('operations')} where workspace_id = $1::uuid and revision = $2 and inverse is not null`, [scope.id, scope.revision])
    return op ? { operationId: op.operation_id, revision: scope.revision } : undefined
  }
  private async read(tx: SqlClient, lock: boolean): Promise<{ scope: Scope; rows: Rows; workspace: Workspace }> {
    const scope = await this.scope(tx, lock), rows = await this.readRows(tx, scope)
    const workspace = workspaceOf(rows)
    const undo = await this.undoMarker(tx, scope)
    if (undo) workspace.undo = undo
    return { scope, rows, workspace }
  }
  private async writeDiff(tx: SqlClient, workspaceId: string, diff: Omit<RowDiff, 'timezone'>): Promise<void> {
    const upsert = async <R extends object>(table: string, columns: readonly string[], rows: R[]) => {
      for (const r of rows) {
        const values = columns.map(c => (r as Record<string, unknown>)[c])
        const placeholders = columns.map((c, i) => c === 'data' ? `$${i + 2}::text::json` : `$${i + 2}`)
        await tx.query(`insert into ${this.t(table)} (workspace_id, ${columns.join(', ')}) values ($1::uuid, ${placeholders.join(', ')})
          on conflict (workspace_id, id) do update set ${columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`, [workspaceId, ...values])
      }
    }
    const remove = async (table: string, ids: string[]) => { if (ids.length) await tx.query(`delete from ${this.t(table)} where workspace_id = $1::uuid and id = any($2::text[])`, [workspaceId, ids]) }
    await upsert('pages', pageColumns, diff.pages.upsert); await remove('pages', diff.pages.remove)
    await upsert('tasks', taskColumns, diff.tasks.upsert); await remove('tasks', diff.tasks.remove)
    await upsert('deleted_tasks', deletedColumns, diff.deleted.upsert); await remove('deleted_tasks', diff.deleted.remove)
  }
  /** Operations older than `operationKeepMs` go, except the newest of the workspace (the Undo marker). */
  async pruneOperations(tx: SqlClient, workspaceId: string, now: Date): Promise<void> {
    await tx.query(`delete from ${this.t('operations')} where workspace_id = $1::uuid and created_at < $2
      and revision < (select max(revision) from ${this.t('operations')} where workspace_id = $1::uuid)`, [workspaceId, new Date(now.getTime() - operationKeepMs).toISOString()])
  }
  private async writeOperation(tx: SqlClient, workspaceId: string, receipt: Receipt, revision: number, type: string, inverse: RowDiff | null): Promise<void> {
    await tx.query(`insert into ${this.t('operations')} (workspace_id, operation_id, revision, type, receipt, inverse) values ($1::uuid, $2, $3, $4, $5::text::json, $6::text::json)`,
      [workspaceId, receipt.operationId, revision, type, JSON.stringify(receipt), inverse ? JSON.stringify(inverse) : null])
  }

  /**
   * One command in one transaction: the workspace row locked, the rows read, the domain command applied to them with
   * the receipt it may be a replay of and (for an Undo) the previous state rebuilt from the operation's inverse, then
   * the changed rows, the revision and the operation written. `expected`: the command's own revision check, or the
   * current one for background work.
   */
  private async apply(command: Command, expected?: 'latest'): Promise<{ result: CommandResult; before: number }> {
    await this.init()
    return this.sql.transaction(async tx => {
      const { scope, rows, workspace } = await this.read(tx, true)
      const [replay] = await tx.query<{ receipt: string }>(`select receipt::text as receipt from ${this.t('operations')} where workspace_id = $1::uuid and operation_id = $2`, [scope.id, command.operationId])
      if (replay) workspace.receipts = { [command.operationId]: JSON.parse(replay.receipt) as Receipt }
      if (command.action.type === 'undo' && workspace.undo?.operationId === command.action.targetOperationId) {
        const [op] = await tx.query<{ inverse: string | null }>(`select inverse::text as inverse from ${this.t('operations')} where workspace_id = $1::uuid and operation_id = $2`, [scope.id, command.action.targetOperationId])
        if (op?.inverse) { const { undo: _undo, receipts: _receipts, ...before } = workspaceOf(applyDiff(rows, JSON.parse(op.inverse) as RowDiff)); workspace.undo = { ...workspace.undo, before: { ...before, receipts: {} } } }
      }
      const result = applyCommand(workspace, expected === 'latest' ? { ...command, expectedRevision: workspace.revision } : command)
      const after = result.workspace
      if (after.revision !== workspace.revision) {
        const { write, inverse } = planWrites(rows, after)
        await this.writeDiff(tx, scope.id, write)
        await tx.query(`update ${this.t('workspaces')} set revision = $2, timezone = $3 where id = $1::uuid`, [scope.id, after.revision, after.timezone])
        await this.writeOperation(tx, scope.id, result.receipt, after.revision, command.action.type, after.undo?.operationId === command.operationId ? inverse : null)
        if (after.revision % pruneEvery === 0) await this.pruneOperations(tx, scope.id, new Date())
      }
      // The browser and the caller get the Undo marker, never the copy, and no receipts: replay lookups are the store's.
      const { undo, ...rest } = after
      return { result: { ...result, workspace: { ...rest, receipts: {}, ...(undo ? { undo: { operationId: undo.operationId, revision: undo.revision } } : {}) } }, before: workspace.revision }
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
      const { result, before } = await this.apply(command)
      debugLog('command.finish', { ...fields, beforeRevision: before, afterRevision: result.workspace.revision, elapsedMs: performance.now() - started, result: result.workspace.revision === before ? 'replay' : 'committed' })
      return result
    } catch (error) {
      debugLog('command.finish', { ...fields, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' })
      throw error
    }
  }
  /** A server-only command applied to the workspace as it is now: background work isn't refused because he typed meanwhile. */
  async executeOnLatest(operationId: string, action: Command['action']): Promise<CommandResult> {
    return (await this.apply({ operationId, expectedRevision: 0, action }, 'latest')).result
  }
}
