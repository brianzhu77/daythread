import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient } from '../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { PushStore, sentKeepMs } from '../src/server/push/store.ts'
import { handleSubscribe, handleUnsubscribe, runTick, tickAllowed, usePushStore, usePushWorkspaceStore } from '../src/server/push/server.ts'
import type { PushPayload, SendResult } from '../src/server/push/send.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { dateOnlyTime, dueReminders, zonedEpoch } from '../src/domain/reminders.ts'
import type { Workspace } from '../src/domain/types.ts'

// Reminders for @date chips over web push (docs/design/reminders.md): what is due, what was sent, and the handlers.

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const chip = (eventId: string, date: string, time: string | null) => ({ type: 'dateMention', props: { eventId, date, time: time ?? '' } })
const line = (id: string, content: unknown[]) => ({ id, type: 'paragraph', props: {}, content, children: [] })
const workspace = (timezone: string, pages: { id: string; type: 'daily' | 'document'; date: string | null; title: string; nodes: unknown[]; trashedAt?: string }[]): Workspace => ({
  schemaVersion: 2, revision: 1, timezone, tasks: [], deletedTasks: [], receipts: {},
  pages: pages.map(({ nodes, ...p }) => ({ ...p, document: JSON.stringify(nodes) })) as Workspace['pages'],
})
const ws = workspace('America/Vancouver', [
  { id: 'day:2026-10-28', type: 'daily', date: '2026-10-28', title: '2026-10-28', nodes: [line('l1', [text('Dentist '), chip('e1', '2026-10-28', '15:00')]), line('l2', [text('Pay rent '), chip('e2', '2026-10-28', null)])] },
  { id: 'p-doc', type: 'document', date: null, title: 'Trip', nodes: [line('l3', [chip('e3', '2026-10-29', '08:30'), text(' Flight')])] },
  { id: 'p-trash', type: 'document', date: null, title: 'Old', trashedAt: '2026-10-01T00:00:00Z', nodes: [line('l4', [text('Gone '), chip('e4', '2026-10-28', '15:00')])] },
])
const vancouver = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h + 7, mi) // PDT in October

test('zonedEpoch: a wall-clock time in a zone, DST aware; an unknown zone counts as UTC', () => {
  assert.equal(zonedEpoch('2026-10-28', '15:00', 'America/Vancouver'), Date.UTC(2026, 9, 28, 22, 0), 'PDT is UTC-7')
  assert.equal(zonedEpoch('2026-12-01', '15:00', 'America/Vancouver'), Date.UTC(2026, 11, 1, 23, 0), 'PST is UTC-8')
  assert.equal(zonedEpoch('2026-10-28', '09:00', 'Asia/Shanghai'), Date.UTC(2026, 9, 28, 1, 0))
  assert.equal(zonedEpoch('2026-10-28', '09:00', 'Not/AZone'), Date.UTC(2026, 9, 28, 9, 0))
})

test('dueReminders: a timed chip fires at its time, a date-only chip at 9:00, in the workspace zone; trashed pages never', () => {
  const all = dueReminders(ws, vancouver(2026, 10, 27, 0), vancouver(2026, 10, 30, 0))
  assert.deepEqual(all.map(r => [r.eventId, new Date(r.fireAt).toISOString(), r.title, r.body, r.url]), [
    ['e2', new Date(vancouver(2026, 10, 28, 9)).toISOString(), 'Pay rent', 'Wed, Oct 28', '/day/2026-10-28'],
    ['e1', new Date(vancouver(2026, 10, 28, 15)).toISOString(), 'Dentist', 'Wed, Oct 28 · 3pm', '/day/2026-10-28'],
    ['e3', new Date(vancouver(2026, 10, 29, 8, 30)).toISOString(), 'Flight', 'Thu, Oct 29 · 8:30am', '/pages?page=p-doc'],
  ])
  assert.equal(dateOnlyTime, '09:00')
  assert.ok(all.every(r => r.key === `${r.eventId}@${r.fireAt}`))
  // The window: after `from`, up to and including `to`.
  const at = vancouver(2026, 10, 28, 15)
  assert.deepEqual(dueReminders(ws, at - 60_000, at).map(r => r.eventId), ['e1'])
  assert.deepEqual(dueReminders(ws, at, at + 60_000).map(r => r.eventId), [])
  assert.deepEqual(dueReminders(ws, at - 3600_000, at - 1).map(r => r.eventId), [])
})

async function stores() {
  const db = await PGlite.create()
  const sql = pgliteClient(db), repo = new PostgresWorkspaceRepository(sql, undefined, { today: '2026-10-28' })
  await repo.prepare()
  const [wsA, wsB] = await Promise.all([repo.workspaceIdFor(A), repo.workspaceIdFor(B)])
  const push = new PushStore(sql)
  await push.prepare()
  return { db, sql, repo, push, wsA, wsB }
}
const sub = (n: number) => ({ endpoint: `https://push.example/s${n}`, p256dh: `p${n}`, auth: `a${n}` })

test('PushStore: a subscription belongs to one workspace, the same endpoint again moves it, only its own workspace can drop it, RLS is on', async () => {
  const { db, sql, push, wsA, wsB } = await stores()
  await push.subscribe(wsA, sub(1)); await push.subscribe(wsA, sub(2)); await push.subscribe(wsB, sub(3))
  assert.deepEqual((await push.subscribed()).map(w => [w.workspaceId, w.subscriptions.map(s => s.endpoint)]).sort(), [[wsA, [sub(1).endpoint, sub(2).endpoint]], [wsB, [sub(3).endpoint]]].sort())
  await push.subscribe(wsB, { ...sub(1), auth: 'new' })
  assert.deepEqual((await push.subscriptionsOf(wsB)).map(s => [s.endpoint, s.auth]).sort(), [[sub(1).endpoint, 'new'], [sub(3).endpoint, 'a3']].sort(), 'moved, keys updated')
  await push.unsubscribe(wsA, sub(3).endpoint)
  assert.equal((await push.subscriptionsOf(wsB)).length, 2, 'another workspace cannot drop it')
  await push.unsubscribe(wsB, sub(3).endpoint); await push.remove(sub(1).endpoint)
  assert.deepEqual(await push.subscriptionsOf(wsB), [])
  for (const t of ['push_subscriptions', 'push_sent']) assert.equal((await sql.query<{ rowsecurity: boolean }>(`select rowsecurity from pg_tables where tablename = '${t}'`))[0]!.rowsecurity, true, t)
  // Sent keys: remembered for a week.
  await push.markSent(wsA, ['k1', 'k2'], new Date('2026-10-28T10:00:00Z'))
  assert.deepEqual(await push.unsent(wsA, ['k1', 'k2', 'k3']), ['k3'])
  assert.deepEqual(await push.unsent(wsB, ['k1']), ['k1'], 'per workspace')
  await push.prune(new Date(Date.parse('2026-10-28T10:00:00Z') + sentKeepMs + 1))
  assert.deepEqual(await push.unsent(wsA, ['k1']), ['k1'], 'pruned after a week')
  await db.close()
})

test('runTick: each due reminder once per subscription, never twice; a gone endpoint is dropped; a failed send is tried again next tick', async () => {
  const { db, push, repo, wsA, wsB } = await stores()
  await push.subscribe(wsA, sub(1)); await push.subscribe(wsA, sub(2)); await push.subscribe(wsB, sub(3))
  const sent: [string, PushPayload][] = []
  const results = new Map<string, SendResult>()
  const send = async (s: { endpoint: string }, payload: PushPayload) => { sent.push([s.endpoint, payload]); return results.get(s.endpoint) ?? 'ok' as SendResult }
  const loadWorkspace = async (id: string) => (id === wsA ? ws : workspace('Asia/Shanghai', [{ id: 'd', type: 'daily', date: '2026-10-28', title: 'd', nodes: [line('x', [text('Standup '), chip('e9', '2026-10-28', '10:00')])] }]))
  // 3pm Vancouver on Oct 28 = 22:00Z; Shanghai's 10:00 was 02:00Z, long before.
  const now = new Date(vancouver(2026, 10, 28, 15, 2))
  const first = await runTick({ store: push, loadWorkspace, send, now })
  assert.deepEqual(first, { workspaces: 2, due: 1, sent: 2, gone: 0, failed: 0 })
  assert.deepEqual(sent.map(([e, p]) => [e, p.title, p.body, p.url]), [[sub(1).endpoint, 'Dentist', 'Wed, Oct 28 · 3pm', '/day/2026-10-28'], [sub(2).endpoint, 'Dentist', 'Wed, Oct 28 · 3pm', '/day/2026-10-28']])
  sent.length = 0
  assert.deepEqual(await runTick({ store: push, loadWorkspace, send, now: new Date(now.getTime() + 60_000) }), { workspaces: 2, due: 0, sent: 0, gone: 0, failed: 0 }, 'a second tick sends nothing')
  // The next reminder: for wsA one endpoint is gone (410) and the other fails (5xx): the gone one is dropped and the
  // reminder counts as taken. For wsB the only endpoint fails, so its reminder stays unsent.
  results.set(sub(1).endpoint, 'gone'); results.set(sub(2).endpoint, 'failed'); results.set(sub(3).endpoint, 'failed')
  const later = new Date(vancouver(2026, 10, 29, 8, 31))
  const freshWs = workspace('America/Vancouver', [{ id: 'p-doc', type: 'document', date: null, title: 'Trip', nodes: [line('l3', [chip('e3', '2026-10-29', '08:30'), text(' Flight')])] }])
  assert.deepEqual(await runTick({ store: push, loadWorkspace: async () => freshWs, send, now: later }), { workspaces: 2, due: 2, sent: 0, gone: 1, failed: 2 })
  assert.deepEqual((await push.subscriptionsOf(wsA)).map(s => s.endpoint), [sub(2).endpoint], 'the gone endpoint is dropped')
  // wsB's send failed: still unsent, so the next tick tries again within the window; wsA is done with it.
  results.set(sub(2).endpoint, 'ok')
  sent.length = 0
  const again = await runTick({ store: push, loadWorkspace: async () => freshWs, send, now: new Date(later.getTime() + 60_000) })
  assert.deepEqual(again, { workspaces: 2, due: 1, sent: 0, gone: 0, failed: 1 }, 'wsA took it already (sub 1 was gone); wsB tries again')
  assert.deepEqual(sent.map(([e]) => e), [sub(3).endpoint])
  await db.close()
  void repo
})

test('tickAllowed: CRON_SECRET in the header or the query, nothing without it', () => {
  const env = { CRON_SECRET: 's3cret' } as NodeJS.ProcessEnv
  assert.equal(tickAllowed(new Request('https://d.app/api/push/tick', { headers: { authorization: 'Bearer s3cret' } }), env), 'ok')
  assert.equal(tickAllowed(new Request('https://d.app/api/push/tick?token=s3cret'), env), 'ok')
  assert.equal(tickAllowed(new Request('https://d.app/api/push/tick?token=nope'), env), 'unauthorized')
  assert.equal(tickAllowed(new Request('https://d.app/api/push/tick'), env), 'unauthorized')
  assert.equal(tickAllowed(new Request('https://d.app/api/push/tick?token=s3cret'), {} as NodeJS.ProcessEnv), 'not-configured')
})

test('handleSubscribe and handleUnsubscribe: same-origin JSON for the signed-in account’s workspace; keys required', async () => {
  const { db, push, repo, wsA } = await stores()
  usePushStore(push); usePushWorkspaceStore(repo)
  const post = (path: string, body: unknown, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
    new Request(`https://d.app${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const good = { endpoint: 'https://push.example/s1', keys: { p256dh: 'p1', auth: 'a1' } }
  try {
    delete process.env.DAYTHREAD_VAPID_PUBLIC_KEY; delete process.env.DAYTHREAD_VAPID_PRIVATE_KEY
    assert.equal((await asOwner(A, () => handleSubscribe(post('/api/push/subscribe', good)))).status, 503, 'no keys: not configured')
    process.env.DAYTHREAD_VAPID_PUBLIC_KEY = 'pub'; process.env.DAYTHREAD_VAPID_PRIVATE_KEY = 'priv'
    assert.equal((await asOwner(A, () => handleSubscribe(post('/api/push/subscribe', good, { 'sec-fetch-site': 'cross-site' })))).status, 403)
    assert.equal((await asOwner(A, () => handleSubscribe(post('/api/push/subscribe', { endpoint: 'http://push.example/s1', keys: good.keys })))).status, 400, 'https only')
    assert.equal((await asOwner(A, () => handleSubscribe(post('/api/push/subscribe', { endpoint: good.endpoint })))).status, 400)
    const ok = await asOwner(A, () => handleSubscribe(post('/api/push/subscribe', good)))
    assert.equal(ok.status, 200)
    assert.deepEqual((await push.subscriptionsOf(wsA)).map(s => s.endpoint), [good.endpoint])
    assert.equal((await asOwner(B, () => handleUnsubscribe(post('/api/push/unsubscribe', { endpoint: good.endpoint })))).status, 200)
    assert.equal((await push.subscriptionsOf(wsA)).length, 1, 'another account cannot drop it')
    assert.equal((await asOwner(A, () => handleUnsubscribe(post('/api/push/unsubscribe', { endpoint: good.endpoint })))).status, 200)
    assert.equal((await push.subscriptionsOf(wsA)).length, 0)
  } finally {
    delete process.env.DAYTHREAD_VAPID_PUBLIC_KEY; delete process.env.DAYTHREAD_VAPID_PRIVATE_KEY
    usePushStore(undefined); usePushWorkspaceStore(undefined)
    await db.close()
  }
})
