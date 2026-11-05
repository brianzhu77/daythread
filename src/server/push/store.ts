// Web push subscriptions and what was sent (docs/design/reminders.md). A subscription is one browser (one device,
// one profile) that asked for reminders, linked to the workspace it was signed in to; the same endpoint asked again
// moves to that workspace. `push_sent` keeps each reminder's key for a week, so a tick never sends twice. Same
// schema as the workspace, RLS on with no policies.
import type { SqlClient } from '../db/sql.ts'
import { schemaName } from '../postgres-repository.ts'

export interface PushSubscription { endpoint: string; p256dh: string; auth: string }
export interface SubscribedWorkspace { workspaceId: string; subscriptions: (PushSubscription & { since: number })[] }

/** How long a sent key is remembered: longer than any window a tick looks back over. */
export const sentKeepMs = 7 * 24 * 3600_000
/** How long a tick holds a reminder it's sending: longer than a tick's sends take, and short enough that one that died is retried within the hour it's looked for. */
export const leaseMs = 5 * 60_000

export class PushStore {
  private ready?: Promise<void>
  private readonly sql: SqlClient
  private readonly schema: string
  constructor(sql: SqlClient, schema = schemaName()) { this.sql = sql; this.schema = schema }
  private t(name: string): string { return `${this.schema}.${name}` }

  private init(): Promise<void> {
    const exists = async (sql: SqlClient) => (await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = any($2::text[]) and c.relrowsecurity
          and exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = case c.relname when 'push_subscriptions' then 'gone_at' else 'lease_until' end and not a.attisdropped)`, [this.schema, ['push_subscriptions', 'push_sent']]))[0]?.n === 2
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
        alter table ${this.t('push_subscriptions')} add column if not exists gone_at timestamptz;
        create index if not exists push_subscriptions_workspace on ${this.t('push_subscriptions')} (workspace_id);
        alter table ${this.t('push_subscriptions')} enable row level security;
        create table if not exists ${this.t('push_sent')} (
          workspace_id uuid not null references ${this.t('workspaces')} (id) on delete cascade,
          key text not null,
          sent_at timestamptz not null default now(),
          primary key (workspace_id, key)
        );
        alter table ${this.t('push_sent')} add column if not exists lease_until timestamptz;
        alter table ${this.t('push_sent')} enable row level security;`)
    })).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  prepare(): Promise<void> { return this.init() }

  async subscribe(workspaceId: string, sub: PushSubscription): Promise<void> {
    await this.init()
    await this.sql.query(`insert into ${this.t('push_subscriptions')} (endpoint, workspace_id, p256dh, auth) values ($1, $2::uuid, $3, $4)
      on conflict (endpoint) do update set workspace_id = excluded.workspace_id, p256dh = excluded.p256dh, auth = excluded.auth, gone_at = null,
        created_at = case when ${this.t('push_subscriptions')}.gone_at is null and ${this.t('push_subscriptions')}.workspace_id = excluded.workspace_id then ${this.t('push_subscriptions')}.created_at else now() end`, [sub.endpoint, workspaceId, sub.p256dh, sub.auth])
  }
  /** Removes the endpoint when it belongs to this workspace (a browser can only drop its own). */
  async unsubscribe(workspaceId: string, endpoint: string): Promise<void> {
    await this.init()
    await this.sql.query(`delete from ${this.t('push_subscriptions')} where endpoint = $1 and workspace_id = $2::uuid`, [endpoint, workspaceId])
  }
  /** The push service said the endpoint is gone. Its row stays, marked, so the app can say reminders stopped when he didn't stop them. */
  async remove(endpoint: string): Promise<void> {
    await this.init()
    await this.sql.query(`update ${this.t('push_subscriptions')} set gone_at = now() where endpoint = $1`, [endpoint])
  }
  /** Reminders stopped by themselves: a device had them, the push service dropped it, and no device has them now. Turning them off leaves no row, so it says nothing. */
  async stopped(workspaceId: string): Promise<boolean> {
    await this.init()
    const [row] = await this.sql.query<{ stopped: boolean }>(`select coalesce(bool_or(gone_at is not null) and bool_and(gone_at is not null), false) as stopped from ${this.t('push_subscriptions')} where workspace_id = $1::uuid`, [workspaceId])
    return Boolean(row?.stopped)
  }
  async subscriptionsOf(workspaceId: string): Promise<PushSubscription[]> {
    await this.init()
    return this.sql.query<PushSubscription>(`select endpoint, p256dh, auth from ${this.t('push_subscriptions')} where workspace_id = $1::uuid and gone_at is null order by created_at`, [workspaceId])
  }
  /** Every workspace with at least one subscription, with its subscriptions. */
  async subscribed(): Promise<SubscribedWorkspace[]> {
    await this.init()
    const rows = await this.sql.query<PushSubscription & { workspace_id: string; created_at: string | Date }>(`select workspace_id::text as workspace_id, endpoint, p256dh, auth, created_at from ${this.t('push_subscriptions')} where gone_at is null order by workspace_id, created_at`)
    const out = new Map<string, SubscribedWorkspace['subscriptions']>()
    for (const { workspace_id, created_at, ...sub } of rows) out.set(workspace_id, [...(out.get(workspace_id) ?? []), { ...sub, since: new Date(created_at).getTime() }])
    return [...out].map(([workspaceId, subscriptions]) => ({ workspaceId, subscriptions }))
  }
  /**
   * Of `keys`, the ones this tick may send: not sent yet, and not being sent by a tick that's still within its lease. Taking them
   * here is what stops two ticks sending one reminder (Ratchet, #138). A tick that dies mid-send only holds them until the lease ends.
   */
  async claim(workspaceId: string, keys: string[], now: Date): Promise<string[]> {
    await this.init()
    if (!keys.length) return []
    const lease = new Date(now.getTime() + leaseMs)
    const rows = await this.sql.query<{ key: string }>(`insert into ${this.t('push_sent')} (workspace_id, key, sent_at, lease_until) select $1::uuid, k, $3::timestamptz, $4::timestamptz from unnest($2::text[]) as k
      on conflict (workspace_id, key) do update set lease_until = excluded.lease_until where ${this.t('push_sent')}.lease_until is not null and ${this.t('push_sent')}.lease_until <= $3::timestamptz returning key`, [workspaceId, keys, now, lease])
    const taken = new Set(rows.map(r => r.key))
    return keys.filter(k => taken.has(k))
  }
  /** Sent: the claim stays as the record that it was. */
  async markSent(workspaceId: string, keys: string[], at: Date): Promise<void> {
    await this.init()
    if (keys.length) await this.sql.query(`update ${this.t('push_sent')} set sent_at = $3::timestamptz, lease_until = null where workspace_id = $1::uuid and key = any($2::text[])`, [workspaceId, keys, at])
  }
  /** Every send failed: the next tick may try again while the window lasts. */
  async release(workspaceId: string, keys: string[]): Promise<void> {
    await this.init()
    if (keys.length) await this.sql.query(`delete from ${this.t('push_sent')} where workspace_id = $1::uuid and key = any($2::text[]) and lease_until is not null`, [workspaceId, keys])
  }
  /** Sent keys older than `sentKeepMs` go; a tick calls this now and then. */
  async prune(now: Date): Promise<void> {
    await this.init()
    await this.sql.query(`delete from ${this.t('push_sent')} where sent_at < $1`, [new Date(now.getTime() - sentKeepMs)])
  }
}
