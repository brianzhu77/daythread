// Web push subscriptions and what was sent (docs/design/reminders.md). A subscription is one browser (one device,
// one profile) that asked for reminders, linked to the workspace it was signed in to; the same endpoint asked again
// moves to that workspace. `push_sent` keeps each reminder's key for a week, so a tick never sends twice. Same
// schema as the workspace, RLS on with no policies.
import type { SqlClient } from '../db/sql.ts'
import { schemaName } from '../postgres-repository.ts'

export interface PushSubscription { endpoint: string; p256dh: string; auth: string }
export interface SubscribedWorkspace { workspaceId: string; subscriptions: PushSubscription[] }

/** How long a sent key is remembered: longer than any window a tick looks back over. */
export const sentKeepMs = 7 * 24 * 3600_000

export class PushStore {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly schema: string
  constructor(sql: SqlClient, schema = schemaName()) { this.sql = sql; this.schema = schema }
  private t(name: string): string { return `${this.schema}.${name}` }

  private init(): Promise<void> {
    const exists = async (sql: SqlClient) => (await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = any($2::text[]) and c.relrowsecurity`, [this.schema, ['push_subscriptions', 'push_sent']]))[0]?.n === 2
    this.ready ??= exists(this.sql).then(ok => ok ? undefined : this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
      if (await exists(tx)) return
      const s = this.schema
      await tx.exec(`create schema if not exists ${s};
        create table if not exists ${this.t('push_subscriptions')} (
          endpoint text primary key,
          workspace_id uuid not null references ${this.t('workspaces')} (id) on delete cascade,
          p256dh text not null,
          auth text not null,
          created_at timestamptz not null default now()
        );
        create index if not exists push_subscriptions_workspace on ${this.t('push_subscriptions')} (workspace_id);
        alter table ${this.t('push_subscriptions')} enable row level security;
        create table if not exists ${this.t('push_sent')} (
          workspace_id uuid not null references ${this.t('workspaces')} (id) on delete cascade,
          key text not null,
          sent_at timestamptz not null default now(),
          primary key (workspace_id, key)
        );
        alter table ${this.t('push_sent')} enable row level security;`)
    })).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  prepare(): Promise<void> { return this.init() }

  async subscribe(workspaceId: string, sub: PushSubscription): Promise<void> {
    await this.init()
    await this.sql.query(`insert into ${this.t('push_subscriptions')} (endpoint, workspace_id, p256dh, auth) values ($1, $2::uuid, $3, $4)
      on conflict (endpoint) do update set workspace_id = excluded.workspace_id, p256dh = excluded.p256dh, auth = excluded.auth`, [sub.endpoint, workspaceId, sub.p256dh, sub.auth])
  }
  /** Removes the endpoint when it belongs to this workspace (a browser can only drop its own). */
  async unsubscribe(workspaceId: string, endpoint: string): Promise<void> {
    await this.init()
    await this.sql.query(`delete from ${this.t('push_subscriptions')} where endpoint = $1 and workspace_id = $2::uuid`, [endpoint, workspaceId])
  }
  /** The push service said the endpoint is gone. */
  async remove(endpoint: string): Promise<void> {
    await this.init()
    await this.sql.query(`delete from ${this.t('push_subscriptions')} where endpoint = $1`, [endpoint])
  }
  async subscriptionsOf(workspaceId: string): Promise<PushSubscription[]> {
    await this.init()
    return this.sql.query<PushSubscription>(`select endpoint, p256dh, auth from ${this.t('push_subscriptions')} where workspace_id = $1::uuid order by created_at`, [workspaceId])
  }
  /** Every workspace with at least one subscription, with its subscriptions. */
  async subscribed(): Promise<SubscribedWorkspace[]> {
    await this.init()
    const rows = await this.sql.query<PushSubscription & { workspace_id: string }>(`select workspace_id::text as workspace_id, endpoint, p256dh, auth from ${this.t('push_subscriptions')} order by workspace_id, created_at`)
    const out = new Map<string, PushSubscription[]>()
    for (const { workspace_id, ...sub } of rows) out.set(workspace_id, [...(out.get(workspace_id) ?? []), sub])
    return [...out].map(([workspaceId, subscriptions]) => ({ workspaceId, subscriptions }))
  }
  /** Of `keys`, the ones not yet sent to this workspace. */
  async unsent(workspaceId: string, keys: string[]): Promise<string[]> {
    await this.init()
    if (!keys.length) return []
    const sent = new Set((await this.sql.query<{ key: string }>(`select key from ${this.t('push_sent')} where workspace_id = $1::uuid and key = any($2::text[])`, [workspaceId, keys])).map(r => r.key))
    return keys.filter(k => !sent.has(k))
  }
  async markSent(workspaceId: string, keys: string[], at: Date): Promise<void> {
    await this.init()
    for (const key of keys) await this.sql.query(`insert into ${this.t('push_sent')} (workspace_id, key, sent_at) values ($1::uuid, $2, $3) on conflict do nothing`, [workspaceId, key, at])
  }
  /** Sent keys older than `sentKeepMs` go; a tick calls this now and then. */
  async prune(now: Date): Promise<void> {
    await this.init()
    await this.sql.query(`delete from ${this.t('push_sent')} where sent_at < $1`, [new Date(now.getTime() - sentKeepMs)])
  }
}
