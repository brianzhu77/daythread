// The workspace on Postgres (Supabase) as rows, one workspace per account (shot 2): `workspaces`, `pages`, `tasks`,
// `deleted_tasks` and `operations`, every row carrying its workspace id. A command locks the workspace row, applies
// the domain command and writes only the rows that changed, in one transaction; the operation's receipt (for replay)
// and the rows as they were (its inverse, for Undo) go to `operations`. Shot 1's single row is migrated on first start.
import { leavesUndoAlone, noteCommands } from '../domain/comments.ts'
import { applyCommand, createEmptyWorkspace } from '../domain/workspace.ts'
import { changesBetween, type WorkspaceChanges } from '../domain/workspace-changes.ts'
import { upgradeWorkspace } from '../domain/convert-v1.ts'
import type { Command, CommandResult, Receipt, WeekStart, Workspace } from '../domain/types.ts'
import { todayIn, type ServerRepository } from './repository.ts'
import type { SqlClient } from './db/sql.ts'
import { commandLogFields, debugLog } from './debug-log.ts'
import { currentOwner } from './auth/request-owner.ts'
import { applyDiff, planWrites, rowsOf, threadOptional, workspaceOf, type DeletedRow, type LinkRow, type ThreadRow, type PageRow, type RowDiff, type Rows, type TaskRow } from './workspace-rows.ts'

export function schemaName(value = process.env.DAYTHREAD_PG_SCHEMA ?? 'daythread'): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('DAYTHREAD_PG_SCHEMA must be a lowercase SQL identifier')
  return value
}

export interface WorkspaceInfo { id: string; timezone: string; weekStart: WeekStart; revision: number; /** To-dos' rules, as JSON (automations.md §7). */ todoAutomations?: string | null }

/** An operation is kept this long for replay (a lost response needs seconds; this is generous); the newest is always kept, it carries the Undo marker. */
export const operationKeepMs = 30 * 24 * 3600_000
/** The log is pruned inside the write transaction every this many revisions: no scheduler, no noticeable cost. */
export const pruneEvery = 25
interface Scope extends WorkspaceInfo { userId: string | null }

const upsertBatch = 500
const threadColumns = ['id', 'page_id', 'version', 'created_at', 'resolved_at', 'comments', 'anchor', 'property'] as const
const linkColumns = ['id', 'blocked_id', 'blocker_id', 'created_at'] as const
const pageColumns = ['id', 'position', 'type', 'date', 'title', 'url', 'parent_id', 'trashed_at', 'trash_id', 'document', 'handoff_done', 'review_saved', 'database_json', 'row_values', 'created_at', 'edited_at', 'icon', 'cover', 'cover_position'] as const
/** Columns added to `pages` after its first release (databases): added on start when missing, before any build writes them. */
const addedPageColumns = ['database_json', 'row_values', 'created_at', 'edited_at', 'icon', 'cover', 'cover_position'] as const
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
    const columnsOf = async (sql: SqlClient, table: string) => (await sql.query<{ attname: string }>(
      `select a.attname from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped`, [this.schema, table])).map(r => r.attname)
    const complete = async (sql: SqlClient) => {
      const have = await tables(sql)
      if (!['workspaces', 'pages', 'tasks', 'deleted_tasks', 'operations', 'comment_threads', 'task_links'].every(t => have.includes(t)) || have.includes('workspace')) return false
      const columns = await columnsOf(sql, 'pages'), threadColumnsNow = await columnsOf(sql, 'comment_threads')
      return addedPageColumns.every(c => columns.includes(c)) && (await columnsOf(sql, 'workspaces')).includes('week_start') && (await columnsOf(sql, 'workspaces')).includes('todo_automations') && threadOptional.every(c => threadColumnsNow.includes(c))
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
          create table if not exists ${s}.comment_threads (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            id text not null, page_id text not null, version integer not null, created_at text not null, resolved_at text, comments text not null,
            primary key (workspace_id, id)
          );
          alter table ${s}.comment_threads enable row level security;
          alter table ${s}.comment_threads add column if not exists anchor text;
          alter table ${s}.comment_threads add column if not exists property text;
          create table if not exists ${s}.task_links (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            id text not null, blocked_id text not null, blocker_id text not null, created_at text not null,
            primary key (workspace_id, id)
          );
          alter table ${s}.task_links enable row level security;
          create table if not exists ${s}.operations (
            workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
            operation_id text not null, revision integer not null, type text not null, receipt json not null, inverse json,
            created_at timestamptz not null default now(),
            primary key (workspace_id, operation_id)
          );
          create index if not exists operations_revision on ${s}.operations (workspace_id, revision desc);
          create index if not exists operations_created on ${s}.operations (workspace_id, created_at);
          alter table ${s}.operations enable row level security;
          alter table ${s}.workspaces add column if not exists week_start smallint not null default 0;
          alter table ${s}.workspaces add column if not exists todo_automations text;
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
    const [row] = await sql.query<WorkspaceInfo>(`select id::text as id, timezone, week_start as "weekStart", todo_automations as "todoAutomations", revision from ${this.t('workspaces')} where user_id = $1::uuid`, [userId])
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
    const [info] = await this.sql.query<WorkspaceInfo>(`select id::text as id, timezone, week_start as "weekStart", todo_automations as "todoAutomations", revision from ${this.t('workspaces')} where id = $1::uuid`, [id])
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
      const [local] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, week_start as "weekStart", todo_automations as "todoAutomations", revision from ${this.t('workspaces')} where user_id is null${forUpdate}`)
      if (local) return { ...local, userId: null }
      const id = await this.createWorkspaceIn(tx, null, 'America/Vancouver')
      const [made] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, week_start as "weekStart", todo_automations as "todoAutomations", revision from ${this.t('workspaces')} where id = $1::uuid${forUpdate}`, [id])
      return { ...made!, userId: null }
    }
    const [row] = await tx.query<WorkspaceInfo>(`select id::text as id, timezone, week_start as "weekStart", todo_automations as "todoAutomations", revision from ${this.t('workspaces')} where user_id = $1::uuid${forUpdate}`, [owner])
    if (!row) throw new Error('No workspace for this account')
    return { ...row, userId: owner }
  }
  private async readRows(tx: SqlClient, scope: Scope): Promise<Rows> {
    const [pages, tasks, deleted, threads, links] = await Promise.all([
      tx.query<PageRow>(`select ${pageColumns.join(', ')} from ${this.t('pages')} where workspace_id = $1::uuid order by position`, [scope.id]),
      tx.query<TaskRow>(`select ${taskColumns.join(', ')} from ${this.t('tasks')} where workspace_id = $1::uuid order by position`, [scope.id]),
      tx.query<DeletedRow>(`select id, position, data::text as data from ${this.t('deleted_tasks')} where workspace_id = $1::uuid order by position`, [scope.id]),
      tx.query<ThreadRow>(`select ${threadColumns.join(', ')} from ${this.t('comment_threads')} where workspace_id = $1::uuid`, [scope.id]),
      tx.query<LinkRow>(`select ${linkColumns.join(', ')} from ${this.t('task_links')} where workspace_id = $1::uuid`, [scope.id]),
    ])
    return { revision: scope.revision, timezone: scope.timezone, weekStart: scope.weekStart, todoAutomations: scope.todoAutomations ?? null, pages, tasks, deleted, threads, links }
  }
  /** The Undo marker: the newest operation, when it has an inverse and nothing but notes came after it. A build without comments looks only at the very newest, so it offers none past a note. */
  private async undoMarker(tx: SqlClient, scope: Scope): Promise<Workspace['undo']> {
    const [op] = await tx.query<{ operation_id: string; revision: number; has_inverse: boolean }>(`select operation_id, revision, inverse is not null as has_inverse from ${this.t('operations')} where workspace_id = $1::uuid and type <> all($2::text[]) order by revision desc limit 1`, [scope.id, noteCommands])
    if (!op?.has_inverse) return undefined
    if (Number(op.revision) !== scope.revision && await this.changedComments(tx, scope.id, op.operation_id)) return undefined
    return { operationId: op.operation_id, revision: scope.revision }
  }
  /** Whether an operation's Undo would write comments, which a note since rules out. Asked only when a note is involved, as inverses can be large. */
  private async changedComments(tx: SqlClient, workspaceId: string, operationId: string): Promise<boolean> {
    const [op] = await tx.query<{ changed: boolean }>(`select coalesce(json_array_length(inverse->'threads'->'upsert'), 0) + coalesce(json_array_length(inverse->'threads'->'remove'), 0) > 0 as changed from ${this.t('operations')} where workspace_id = $1::uuid and operation_id = $2`, [workspaceId, operationId])
    return Boolean(op?.changed)
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
      // In batches: at a real distance from the database, a statement a row would hold an import's transaction open for minutes.
      for (let at = 0; at < rows.length; at += upsertBatch) {
        const batch = rows.slice(at, at + upsertBatch), params: unknown[] = [workspaceId]
        const tuples = batch.map(r => `($1::uuid, ${columns.map(c => { params.push((r as Record<string, unknown>)[c]); return c === 'data' ? `$${params.length}::text::json` : `$${params.length}` }).join(', ')})`)
        await tx.query(`insert into ${this.t(table)} (workspace_id, ${columns.join(', ')}) values ${tuples.join(', ')}
          on conflict (workspace_id, id) do update set ${columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`, params)
      }
    }
    const remove = async (table: string, ids: string[]) => { if (ids.length) await tx.query(`delete from ${this.t(table)} where workspace_id = $1::uuid and id = any($2::text[])`, [workspaceId, ids]) }
    await upsert('pages', pageColumns, diff.pages.upsert); await remove('pages', diff.pages.remove)
    await upsert('tasks', taskColumns, diff.tasks.upsert); await remove('tasks', diff.tasks.remove)
    await upsert('deleted_tasks', deletedColumns, diff.deleted.upsert); await remove('deleted_tasks', diff.deleted.remove)
    if (diff.threads) {
      // An inverse written by an older build has no key for what it didn't know (an anchor, a property): the thread keeps the one it has.
      const byColumns = new Map<string, { columns: string[]; rows: ThreadRow[] }>()
      for (const t of diff.threads.upsert) {
        const columns = threadColumns.filter(c => !(threadOptional as readonly string[]).includes(c) || t[c as keyof ThreadRow] !== undefined), key = columns.join()
        const group = byColumns.get(key) ?? { columns, rows: [] }
        group.rows.push(t); byColumns.set(key, group)
      }
      for (const { columns, rows } of byColumns.values()) await upsert('comment_threads', columns, rows)
      await remove('comment_threads', diff.threads.remove)
    }
    if (diff.links) { await upsert('task_links', linkColumns, diff.links.upsert); await remove('task_links', diff.links.remove) }
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
  private async apply(command: Command, expected?: 'latest'): Promise<{ result: CommandResult & { changes: WorkspaceChanges }; before: number }> {
    await this.init()
    return this.sql.transaction(async tx => {
      const { scope, rows, workspace } = await this.read(tx, true)
      const [replay] = await tx.query<{ receipt: string }>(`select receipt::text as receipt from ${this.t('operations')} where workspace_id = $1::uuid and operation_id = $2`, [scope.id, command.operationId])
      if (replay) workspace.receipts = { [command.operationId]: JSON.parse(replay.receipt) as Receipt }
      if (command.action.type === 'undo' && workspace.undo?.operationId === command.action.targetOperationId) {
        const [op] = await tx.query<{ inverse: string | null }>(`select inverse::text as inverse from ${this.t('operations')} where workspace_id = $1::uuid and operation_id = $2`, [scope.id, command.action.targetOperationId])
        if (op?.inverse) { const { undo: _undo, receipts: _receipts, ...before } = workspaceOf(applyDiff(rows, JSON.parse(op.inverse) as RowDiff)); workspace.undo = { ...workspace.undo, before: { ...before, receipts: {} } } }
      }
      if (leavesUndoAlone(command.action.type) && workspace.undo && await this.changedComments(tx, scope.id, workspace.undo.operationId)) delete workspace.undo
      const result = applyCommand(workspace, expected === 'latest' ? { ...command, expectedRevision: workspace.revision } : command)
      const after = result.workspace
      if (after.revision !== workspace.revision) {
        const { write, inverse } = planWrites(rows, after)
        await this.writeDiff(tx, scope.id, write)
        await tx.query(`update ${this.t('workspaces')} set revision = $2, timezone = $3, week_start = $4${write.todoAutomations !== undefined ? ', todo_automations = $5' : ''} where id = $1::uuid`, [scope.id, after.revision, after.timezone, after.weekStart ?? 0, ...(write.todoAutomations !== undefined ? [write.todoAutomations] : [])])
        await this.writeOperation(tx, scope.id, result.receipt, after.revision, command.action.type, after.undo?.operationId === command.operationId ? inverse : null)
        if (after.revision % pruneEvery === 0) await this.pruneOperations(tx, scope.id, new Date())
      }
      // The browser and the caller get the Undo marker, never the copy, and no receipts: replay lookups are the store's.
      const { undo, ...rest } = after
      return { result: { ...result, workspace: { ...rest, receipts: {}, ...(undo ? { undo: { operationId: undo.operationId, revision: undo.revision } } : {}) }, changes: changesBetween(workspace, after) }, before: workspace.revision }
    })
  }

  async heldText(): Promise<string> {
    await this.init()
    const { scope, workspace } = await this.read(this.sql, false)
    const [last] = await this.sql.query<{ inverse: string }>(`select inverse::text as inverse from ${this.t('operations')} where workspace_id = $1::uuid and inverse is not null order by revision desc limit 1`, [scope.id])
    return JSON.stringify(workspace) + (last?.inverse ?? '')
  }
  async load(): Promise<Workspace> {
    await this.init()
    return (await this.read(this.sql, false)).workspace
  }
  async execute(command: Command): Promise<CommandResult & { changes: WorkspaceChanges }> {
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
