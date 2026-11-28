// POST /api/v1/day-draft (docs/design/native-phase-1.md §13.2): the web's prepareDayDraft as plain JSON for the native
// app. No test reaches a model: the model's settings are taken out of the environment, and a draft "with the model on"
// is answered by a stand-in `run`.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { dayDraftRouteReply, handleDayDraft } from '../src/server/api-v1.ts'
import type { DraftRun } from '../src/server/model/day-draft.ts'
import type { DraftItem } from '../src/domain/day-draft.ts'
import { pageNodes } from '../src/domain/editor-document.ts'

delete process.env.OPENROUTER_API_KEY
delete process.env.OPENROUTER_MODEL
const dirs: string[] = []
// The handler reads the store the server is configured with.
process.env.DAYTHREAD_STORAGE = 'sqlite'
process.env.DAYTHREAD_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'daythread-api-v1-day-draft-handlers-')), 'workspace.sqlite')
process.env.DAYTHREAD_LOCAL_DATA_PATH = process.env.DAYTHREAD_SQLITE_PATH.replace(/sqlite$/, 'json')
dirs.push(join(process.env.DAYTHREAD_SQLITE_PATH, '..'))
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

const TODAY = '2026-11-26', pageId = `day:${TODAY}`
const someModel = { apiKey: 'not-a-key', model: 'not-a-model' }
const body = (extra: Record<string, unknown> = {}) => ({ date: TODAY, operationId: 'ask-1', ...extra })
/** The draft log is counts only, and is not test output. */
const quiet = (t: TestContext) => t.mock.method(console, 'info', () => {})

async function withToday() {
  const dir = mkdtempSync(join(tmpdir(), 'daythread-api-v1-day-draft-'))
  dirs.push(dir)
  const repo = new SqliteWorkspaceRepository(join(dir, 'workspace.sqlite'))
  await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: TODAY } })
  return repo
}
async function withDraft(status: 'ready' | 'failed', recipe: number) {
  const repo = await withToday()
  const ws = await repo.load()
  const anchor = pageNodes(ws.pages.find(p => p.id === pageId)!)[0]!.id
  const items: DraftItem[] = [{ id: 'i0', anchor, place: 'after', source: 'model', state: 'open', block: { id: 'b0', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'Stretch', styles: {} }], children: [] } }]
  await repo.execute({ operationId: 'draft', expectedRevision: ws.revision, action: { type: 'set-draft', pageId, status, items, moreOpen: [], allowedTaskIds: [], recipe } })
  return repo
}
const stand = (status: DraftRun['status'], calls: { n: number }) => async (): Promise<DraftRun> => {
  calls.n++
  return { items: [], moreOpen: [], allowedTaskIds: [], status, costUsd: null, ms: 0, returned: 0, kept: 0, drops: {}, carried: 0 }
}

test('day-draft: a day with no draft gets the set-draft command as text, made without the model', async t => {
  const log = quiet(t)
  const repo = await withToday()
  const before = (await repo.load()).revision
  const reply = await dayDraftRouteReply(repo, 'local', null, 'America/Vancouver', body())
  assert.equal(reply.status, 200)
  if (reply.status !== 200) return
  assert.deepEqual(Object.keys(reply.body), ['setDraft', 'owner', 'modelOn', 'remakeFailed'])
  assert.equal(typeof reply.body.setDraft, 'string')
  const command = JSON.parse(reply.body.setDraft!) as Record<string, unknown>
  assert.deepEqual([command.type, command.pageId, command.status, command.recipe], ['set-draft', pageId, 'failed', 5])
  assert.deepEqual([reply.body.owner, reply.body.modelOn, reply.body.remakeFailed], ['local', false, false])
  assert.equal((await repo.load()).revision, before, 'nothing is stored')
  const logged = log.mock.calls.map(c => JSON.parse(String(c.arguments[0])) as Record<string, unknown>).filter(l => l.event === 'draft.prepare')
  assert.deepEqual(logged.map(l => [l.operationId, l.model, l.status]), [['ask-1', false, 'failed']], 'logged once, counts only')
})

test('day-draft: a draft that stands answers setDraft null', async t => {
  quiet(t)
  const repo = await withDraft('ready', 5)
  const calls = { n: 0 }
  assert.deepEqual(await dayDraftRouteReply(repo, 'local', someModel, undefined, body(), stand('ready', calls)), { status: 200, body: { setDraft: null, owner: 'local', modelOn: true, remakeFailed: false } })
  assert.equal(calls.n, 0, 'nothing is made again')
})

test('day-draft: a settled draft of an older recipe with no model answers remakeFailed', async t => {
  quiet(t)
  const repo = await withDraft('ready', 4)
  const calls = { n: 0 }
  assert.deepEqual(await dayDraftRouteReply(repo, 'local', null, undefined, body(), stand('ready', calls)), { status: 200, body: { setDraft: null, owner: 'local', modelOn: false, remakeFailed: true } })
  assert.equal(calls.n, 0, 'run is never called')
})

test('day-draft: a settled older draft whose remake is not ready answers remakeFailed', async t => {
  quiet(t)
  const repo = await withDraft('ready', 4)
  const calls = { n: 0 }
  assert.deepEqual(await dayDraftRouteReply(repo, 'local', someModel, undefined, body(), stand('failed', calls)), { status: 200, body: { setDraft: null, owner: 'local', modelOn: true, remakeFailed: true } })
  assert.equal(calls.n, 1)
})

test('day-draft: a date with no live day page is 404 not-found', async t => {
  quiet(t)
  const repo = await withToday()
  const notFound = { status: 404, body: { error: 'not-found' } }
  assert.deepEqual(await dayDraftRouteReply(repo, 'local', null, undefined, body({ date: '2026-11-27' })), notFound, 'no page')
  await repo.execute({ operationId: 'trash', expectedRevision: (await repo.load()).revision, action: { type: 'delete-page', pageId, at: '2026-11-26T09:00:00.000Z' } })
  assert.deepEqual(await dayDraftRouteReply(repo, 'local', null, undefined, body()), notFound, 'the page in Trash')
  // Through the handler, as the app gets it: the server's own store, made empty, has no page either.
  await new SqliteWorkspaceRepository(process.env.DAYTHREAD_SQLITE_PATH!).load()
  const response = await handleDayDraft(new Request('http://localhost/api/v1/day-draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) }))
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'not-found' }); assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('day-draft: a body that does not read is 400', async t => {
  quiet(t)
  const repo = await withToday()
  const bad = { status: 400, body: { error: 'bad-request' } }
  for (const wrong of [{ operationId: 'ask-1' }, body({ date: '2026-1-1' }), body({ operationId: '' }), body({ operationId: 'x'.repeat(201) }), null, 'not an object'])
    assert.deepEqual(await dayDraftRouteReply(repo, 'local', null, undefined, wrong), bad, JSON.stringify(wrong))
  assert.equal((await dayDraftRouteReply(repo, 'local', null, undefined, body({ operationId: 'x'.repeat(200) }))).status, 200, '200 characters is the limit')
  const response = await handleDayDraft(new Request('http://localhost/api/v1/day-draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' }))
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'bad-request' }); assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('day-draft: the route is wrapped in appRoute, and a body not said to be JSON is 415', async () => {
  // The route file itself, by a path tsc doesn't follow: its types need the router's registration, which the tests'
  // project doesn't include.
  const routeFile: string = '../src/routes/api/v1/day-draft.ts'
  const { Route } = await import(routeFile) as { Route: { options: { server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } } } } }
  const post = Route.options.server.handlers.POST
  const request = new Request('http://localhost/api/v1/day-draft', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body()) })
  const response = await post({ request })
  assert.equal(response.status, 415); assert.deepEqual(await response.json(), { error: 'unsupported-media-type' })
  assert.equal(request.bodyUsed, false, 'the body is never read')
  assert.equal((await post({ request: new Request('http://localhost/api//v1/day-draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) })).status, 404, 'a path the gate did not see as an app path')
})

test('day-draft: signed out, the gate answers 401 signed-out before the route, as on every v1 path', async () => {
  const saved = process.env.DAYTHREAD_AUTH
  delete process.env.DAYTHREAD_AUTH
  try {
    const { checkRequest } = await import('../src/server/auth/server.ts')
    const signedOut: Record<string, string>[] = [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', cookie: '__Host-daythread_session=fromcookie' }]
    for (const headers of signedOut) {
      const answer = await checkRequest(new Request('https://daythread.test/api/v1/day-draft', { method: 'POST', headers, body: JSON.stringify(body()) }), 'router')
      assert.ok(answer instanceof Response)
      assert.equal(answer.status, 401); assert.deepEqual(await answer.json(), { error: 'signed-out' })
    }
  } finally { if (saved === undefined) delete process.env.DAYTHREAD_AUTH; else process.env.DAYTHREAD_AUTH = saved }
})
