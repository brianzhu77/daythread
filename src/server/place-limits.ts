// Place search's limits (place-contract.md §2, D15 G8-5): 30 a minute and 500 a day per account, 60 a minute across the
// deployment, and Photon's own "stop" (a 429) honoured everywhere at once. Held where every Worker instance sees them:
// Postgres, in the workspace's schema, with RLS on and no policies, as the sign-in counts are. Only who searched and
// when is kept, never what. A SQLite store (this machine only) keeps the same numbers in memory.
import type { SqlClient } from './db/sql.ts'
import { schemaName } from './postgres-repository.ts'

export const placeQuota = { perAccountMinute: 30, perAccountDay: 500, perMinute: 60 } as const
const minuteMs = 60_000, dayMs = 24 * 3_600_000

export interface PlaceLimiter {
  /** Counts one search for `owner` if every limit, and any pause, allows it; false (and nothing counted) otherwise. */
  take(owner: string, now: Date): Promise<boolean>
  /** Photon asked us to stop until then (a 429): every instance waits. */
  pause(until: Date): Promise<void>
}

export class PostgresPlaceLimiter implements PlaceLimiter {
  private ready?: Promise<void>
  private readonly searches: string
  private readonly paused: string
  constructor(private readonly sql: SqlClient, private readonly schema = schemaName()) {
    this.searches = `${schema}.place_searches`; this.paused = `${schema}.place_search_pause`
  }

  /** Made once, when missing, under the same lock as the app's other tables, so two cold starts can't race. */
  private init(): Promise<void> {
    const exists = async (sql: SqlClient) => (await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relname = any($2::text[]) and c.relrowsecurity`, [this.schema, ['place_searches', 'place_search_pause']]))[0]?.n === 2
    this.ready ??= exists(this.sql).then(ok => ok ? undefined : this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.init'))")
      if (await exists(tx)) return
      await tx.exec(`create schema if not exists ${this.schema};
        create table if not exists ${this.searches} (user_id text not null, at timestamptz not null);
        create index if not exists place_searches_at on ${this.searches} (at);
        create index if not exists place_searches_user_at on ${this.searches} (user_id, at);
        alter table ${this.searches} enable row level security;
        create table if not exists ${this.paused} (id int primary key check (id = 1), until timestamptz not null);
        alter table ${this.paused} enable row level security;`)
    }))
    return this.ready
  }
  prepare(): Promise<void> { return this.init() }

  /**
   * One check and count in one transaction, under one lock for the whole deployment, so simultaneous searches on any
   * instance can't all read the old counts. At a ceiling of 60 a minute, queueing them costs nothing measurable.
   */
  async take(owner: string, now: Date): Promise<boolean> {
    await this.init()
    return this.sql.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtext('daythread.place-search'))")
      const [row] = await tx.query<{ paused: boolean; mine_minute: number; mine_day: number; all_minute: number }>(
        `select exists(select 1 from ${this.paused} where until > $2) as paused,
          (select count(*)::int from ${this.searches} where user_id = $1 and at > $3) as mine_minute,
          (select count(*)::int from ${this.searches} where user_id = $1 and at > $4) as mine_day,
          (select count(*)::int from ${this.searches} where at > $3) as all_minute`,
        [owner, now.toISOString(), new Date(now.getTime() - minuteMs).toISOString(), new Date(now.getTime() - dayMs).toISOString()])
      if (!row || row.paused || row.mine_minute >= placeQuota.perAccountMinute || row.mine_day >= placeQuota.perAccountDay || row.all_minute >= placeQuota.perMinute) return false
      await tx.query(`insert into ${this.searches} (user_id, at) values ($1, $2)`, [owner, now.toISOString()])
      await tx.query(`delete from ${this.searches} where at < $1`, [new Date(now.getTime() - dayMs).toISOString()])
      return true
    })
  }

  async pause(until: Date): Promise<void> {
    await this.init()
    // A later pause wins; an earlier one never shortens it.
    await this.sql.query(`insert into ${this.paused} (id, until) values (1, $1) on conflict (id) do update set until = greatest(${this.paused}.until, excluded.until)`, [until.toISOString()])
  }
}

/** The same limits for one process: SQLite storage, which only ever serves this machine. */
export class MemoryPlaceLimiter implements PlaceLimiter {
  private readonly times: { owner: string; at: number }[] = []
  private until = 0
  async take(owner: string, now: Date): Promise<boolean> {
    const t = now.getTime()
    while (this.times.length && this.times[0]!.at <= t - dayMs) this.times.shift()
    if (t < this.until) return false
    const mine = this.times.filter(x => x.owner === owner)
    if (mine.filter(x => x.at > t - minuteMs).length >= placeQuota.perAccountMinute || mine.length >= placeQuota.perAccountDay || this.times.filter(x => x.at > t - minuteMs).length >= placeQuota.perMinute) return false
    this.times.push({ owner, at: t })
    return true
  }
  async pause(until: Date): Promise<void> { this.until = Math.max(this.until, until.getTime()) }
}
