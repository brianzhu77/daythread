// Reminders over web push (docs/design/reminders.md): the browser's subscription is kept per workspace, and a tick,
// called by a scheduler with CRON_SECRET, sends what fell due since the last one. Postgres only, like sign-in.
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { dueReminders } from '../../domain/reminders.ts'
import type { Workspace } from '../../domain/types.ts'
import { currentOwner } from '../auth/request-owner.ts'
import { sameOrigin } from '../auth/server.ts'
import { PostgresWorkspaceRepository, schemaName } from '../postgres-repository.ts'
import { getRepository, postgresSql } from '../storage.ts'
import { pushConfig, senderFor, type Sender } from './send.ts'
import { PushStore } from './store.ts'

let pushStore: PushStore | undefined
export const pushes = () => pushStore ??= new PushStore(postgresSql(), schemaName())
/** For tests: a push store on another database. */
export function usePushStore(next: PushStore | undefined): void { pushStore = next }
let repo: PostgresWorkspaceRepository | undefined
function workspaceStore(): PostgresWorkspaceRepository {
  if (repo) return repo
  const r = getRepository()
  if (!(r instanceof PostgresWorkspaceRepository)) throw new Error('Reminders need DAYTHREAD_STORAGE=postgres')
  return repo = r
}
/** For tests: a workspace store on another database. */
export function usePushWorkspaceStore(next: PostgresWorkspaceRepository | undefined): void { repo = next }

const noStore = { 'cache-control': 'no-store' }
const refuse = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: noStore })

/**
 * The VAPID public key the browser subscribes with; null when reminders are not configured (the app then shows nothing).
 * `stopped`: this account's reminders ended without him turning them off, so a page can say so on any device.
 */
export async function handleKey(): Promise<Response> {
  const publicKey = pushConfig()?.publicKey ?? null
  let stopped = false
  if (publicKey) try { stopped = await pushes().stopped(await workspaceStore().workspaceIdFor(currentOwner() ?? null)) } catch { /* a line it can go without */ }
  return Response.json({ publicKey, stopped }, { headers: noStore })
}

const subscriptionBody = z.object({
  endpoint: z.string().url().max(2000).refine(u => u.startsWith('https://'), 'https only'),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
})
const endpointBody = z.object({ endpoint: z.string().url().max(2000) })

export async function handleSubscribe(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, 'origin')
  if (!pushConfig()) return refuse(503, 'not-configured')
  const body = subscriptionBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  try {
    const workspaceId = await workspaceStore().workspaceIdFor(currentOwner() ?? null)
    await pushes().subscribe(workspaceId, { endpoint: body.data.endpoint, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth })
  } catch { return refuse(503, 'unavailable') }
  return Response.json({ ok: true }, { headers: noStore })
}

export async function handleUnsubscribe(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, 'origin')
  const body = endpointBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  try {
    const workspaceId = await workspaceStore().workspaceIdFor(currentOwner() ?? null)
    await pushes().unsubscribe(workspaceId, body.data.endpoint)
  } catch { return refuse(503, 'unavailable') }
  return Response.json({ ok: true }, { headers: noStore })
}

/** How far back a tick looks: a scheduler that skipped a run still delivers, an hour late at worst. */
export const tickWindowMs = 60 * 60_000

export interface TickSummary { workspaces: number; due: number; sent: number; gone: number; failed: number }
interface TickDeps {
  store: Pick<PushStore, 'subscribed' | 'claim' | 'markSent' | 'release' | 'remove' | 'prune'>
  loadWorkspace: (id: string) => Promise<Workspace | null>
  send: Sender
  now?: Date
  windowMs?: number
}
/**
 * One pass over every workspace with a subscription: the reminders due in the window that were not sent yet go to
 * each of its subscriptions. A reminder counts as sent once one subscription took it (or was gone); when every send
 * failed it stays unsent, so the next tick tries again while the window lasts. Turning on is a clean start: a device
 * gets only what falls due after it signed up, so a chip from just before stays quiet (B60 3).
 */
export async function runTick({ store, loadWorkspace, send, now = new Date(), windowMs = tickWindowMs }: TickDeps): Promise<TickSummary> {
  const summary: TickSummary = { workspaces: 0, due: 0, sent: 0, gone: 0, failed: 0 }
  const started = Date.now()
  for (const { workspaceId, subscriptions } of await store.subscribed()) {
    summary.workspaces++
    const ws = await loadWorkspace(workspaceId)
    if (!ws) continue
    const due = dueReminders(ws, now.getTime() - windowMs, now.getTime())
    let live = subscriptions
    for (const reminder of due) {
      // Taken right before it's sent and settled right after, each on its own lease, so a long batch can't outlast one. The clock moves with the batch.
      const at = new Date(now.getTime() + Date.now() - started)
      if (!(await store.claim(workspaceId, [reminder.key], at)).length) continue
      const signedUp = live.filter(s => s.since <= reminder.fireAt)
      if (!signedUp.length) { await store.markSent(workspaceId, [reminder.key], at); continue }
      summary.due++
      // At once, so however many devices, one reminder takes no longer than one send's timeout.
      const results = await Promise.all(signedUp.map(async sub => [sub, await send(sub, { key: reminder.key, title: reminder.title, body: reminder.body, url: reminder.url })] as const))
      let taken = false
      for (const [sub, result] of results) {
        if (result === 'ok') { summary.sent++; taken = true }
        else if (result === 'gone') { summary.gone++; taken = true; await store.remove(sub.endpoint); live = live.filter(s => s.endpoint !== sub.endpoint) }
        else summary.failed++
      }
      if (taken || !live.length) await store.markSent(workspaceId, [reminder.key], at); else await store.release(workspaceId, [reminder.key])
    }
  }
  if (now.getMinutes() === 0) await store.prune(now)
  return summary
}

/** The scheduler's call: `Authorization: Bearer <CRON_SECRET>` (Vercel's cron) or `?token=<CRON_SECRET>`. */
export function tickAllowed(request: Request, env: NodeJS.ProcessEnv = process.env): 'ok' | 'not-configured' | 'unauthorized' {
  const secret = env.CRON_SECRET
  if (!secret) return 'not-configured'
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? new URL(request.url).searchParams.get('token') ?? ''
  const a = Buffer.from(given), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'unauthorized'
}

/** The cron inside the Worker: no request, so no secret to check, and it never throws into the runtime. The subject is the site's address unless one is set. */
export async function scheduledTick(): Promise<void> {
  const config = pushConfig()
  if (!config) return
  const started = Date.now()
  try {
    const store = workspaceStore()
    const summary = await runTick({ store: pushes(), loadWorkspace: id => store.loadWorkspace(id), send: senderFor(config, 'https://daythread.dogrod.com') })
    console.info(JSON.stringify({ level: 'info', event: 'push.tick', ...summary, ms: Date.now() - started }))
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'push.tick.failed', error: error instanceof Error ? error.message.slice(0, 200) : String(error) }))
  }
}

export async function handleTick(request: Request): Promise<Response> {
  const allowed = tickAllowed(request)
  if (allowed !== 'ok') return refuse(allowed === 'not-configured' ? 503 : 401, allowed)
  const config = pushConfig()
  if (!config) return refuse(503, 'not-configured')
  try {
    const store = workspaceStore()
    const summary = await runTick({ store: pushes(), loadWorkspace: id => store.loadWorkspace(id), send: senderFor(config, new URL(request.url).origin) })
    console.info(JSON.stringify({ level: 'info', event: 'push.tick', ...summary }))
    return Response.json({ ok: true, ...summary }, { headers: noStore })
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'push.tick.failed', error: error instanceof Error ? error.message.slice(0, 200) : String(error) }))
    return refuse(503, 'unavailable')
  }
}
