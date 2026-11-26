import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import type { OutboxOutcome } from '../src/server/outbox-command.ts'
import { commandReply, handleCommand, handleSave, haveOf, saveReply, workspaceReply } from '../src/server/api-v1.ts'
import { appRoute } from '../src/server/auth/app-path.ts'

const dirs: string[] = []
// The handlers read the store the server is configured with.
process.env.DAYTHREAD_STORAGE = 'sqlite'
process.env.DAYTHREAD_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'daythread-api-v1-handlers-')), 'workspace.sqlite')
process.env.DAYTHREAD_LOCAL_DATA_PATH = process.env.DAYTHREAD_SQLITE_PATH.replace(/sqlite$/, 'json')
dirs.push(join(process.env.DAYTHREAD_SQLITE_PATH, '..'))
const create = () => {
  const dir = mkdtempSync(join(tmpdir(), 'daythread-api-v1-'))
  dirs.push(dir)
  return new SqliteWorkspaceRepository(join(dir, 'workspace.sqlite'))
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

const withDay = async () => {
  const repo = create()
  await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: '2026-10-22' } })
  return repo
}

test('workspace: whole when the app has nothing or another revision, "unchanged" when it has this one; never the receipts or the undo copy', async () => {
  const repo = await withDay()
  const full = await workspaceReply(repo, 'local', null)
  assert.ok('workspace' in full); assert.equal(full.workspace.revision, 1); assert.deepEqual(full.workspace.receipts, {}); assert.equal(full.owner, 'local')
  assert.deepEqual(await workspaceReply(repo, 'local', 1), { unchanged: true, revision: 1, owner: 'local' })
  assert.ok('workspace' in await workspaceReply(repo, 'local', 0))
})

test('commands: the outbox rule and its outcomes; a body that is not a command is 400', async () => {
  const repo = await withDay()
  // expectedRevision is required by the schema the web outbox already used; runOutbox takes the base from `basis`.
  const body = { operationId: 'add', expectedRevision: 1, action: { type: 'add-task', pageId: 'day:2026-10-22', title: 'Water the plants' }, expectedOwner: 'local', basis: { baseRevision: 1, ownRevisions: [], readsBeyond: false } }
  const outcome = async (owner: string) => {
    const reply = await commandReply(repo, owner, body)
    assert.equal(reply.status, 200)
    return reply.body as OutboxOutcome
  }
  const first = await outcome('local')
  assert.equal(first.status, 'applied'); assert.equal(first.status === 'applied' && first.changes.from, 1)
  assert.equal((await outcome('local')).status, 'applied', 'a replay answers with its receipt')
  assert.equal((await outcome('someone-else')).status, 'owner-mismatch')
  assert.deepEqual(await commandReply(repo, 'local', { nonsense: true }), { status: 400, body: { error: 'bad-request' } })
})

test('saves: save-editor only, checked against the whole revision; a stale one is 409 with the domain\'s words', async () => {
  const repo = await withDay()
  const page = (await repo.load()).pages[0]!
  const save = (expectedRevision: number, operationId: string) => ({ operationId, expectedRevision, action: { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: page.document } })
  assert.equal((await saveReply(repo, 'local', save(1, 's1'))).status, 200)
  await repo.execute({ operationId: 'next-day', expectedRevision: (await repo.load()).revision, action: { type: 'ensure-day', date: '2026-10-23' } })
  const stale = await saveReply(repo, 'local', save(1, 's2'))
  assert.equal(stale.status, 409); assert.match((stale.body as { message: string }).message, /Saved elsewhere/)
  assert.equal((await saveReply(repo, 'local', { operationId: 'x', expectedRevision: 2, action: { type: 'ensure-day', date: '2026-10-23' } })).status, 400)
})

test('saves: an expectedOwner that is the session\'s is applied; another is 409 owner-mismatch and writes nothing; absent behaves as before; not a string is 400', async () => {
  const repo = await withDay()
  const page = (await repo.load()).pages[0]!
  const save = (operationId: string, extra: Record<string, unknown>) => ({ operationId, expectedRevision: 1, action: { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: page.document }, ...extra })
  const other = await saveReply(repo, 'local', save('o1', { expectedOwner: 'someone-else' }))
  assert.deepEqual(other, { status: 409, body: { error: 'owner-mismatch', owner: 'local' } })
  assert.equal((await repo.load()).revision, 1, 'nothing was written')
  assert.equal((await saveReply(repo, 'local', save('o2', { expectedOwner: 'local' }))).status, 200)
  assert.equal((await repo.load()).revision, 2)
  assert.equal((await saveReply(repo, 'local', { ...save('o3', {}), expectedRevision: 2 })).status, 200, 'without the field it is as before')
  for (const bad of [7, null, {}, ['local']]) assert.deepEqual(await saveReply(repo, 'local', save('o4', { expectedOwner: bad })), { status: 400, body: { error: 'bad-request' } })
})

test('a body that is not JSON is the same 400 as one that is not a command', async () => {
  const request = new Request('http://localhost/api/v1/commands', { method: 'POST', body: 'not json' })
  for (const handle of [handleCommand, handleSave]) {
    const response = await handle(request.clone())
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'bad-request' }); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('workspace: a "have" that is absent, empty or not a non-negative integer is the whole workspace', async () => {
  const have = (query: string) => haveOf(new Request(`http://localhost/api/v1/workspace${query}`))
  assert.equal(have(''), null); assert.equal(have('?have='), null); assert.equal(have('?have=-1'), null); assert.equal(have('?have=1.5'), null); assert.equal(have('?have=abc'), null)
  assert.equal(have('?have=0'), 0); assert.equal(have('?have=12'), 12)
})

test('every route file under src/routes/api/v1 wraps its handlers in appRoute', () => {
  const root = new URL('../src/routes/api/v1/', import.meta.url)
  const files = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : [new URL(e.name, dir)])
  const routes = files(root).filter(f => f.pathname.endsWith('.ts'))
  assert.ok(routes.length >= 6)
  for (const file of routes) {
    const source = readFileSync(file, 'utf8')
    const handlers = [...source.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*(\S+)/g)]
    assert.ok(handlers.length > 0, `${file.pathname} declares a handler`)
    for (const [, method, value] of handlers) assert.ok(value!.startsWith('appRoute('), `${file.pathname}: ${method} is not wrapped in appRoute`)
  }
})

test('a v1 write must say it is JSON: anything else is 415 before the handler runs or the body is read; a read needs nothing', async () => {
  let ran = 0
  const route = appRoute(async () => { ran++; return Response.json({ ok: true }) })
  const call = async (method: string, contentType?: string) => {
    const headers: Record<string, string> = contentType === undefined ? {} : { 'content-type': contentType }
    const request = new Request('http://localhost/api/v1/commands', { method, headers, body: method === 'GET' ? undefined : '{"a":1}' })
    return { response: await route({ request }), request }
  }
  for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'text/json']) {
    const { response, request } = await call('POST', type)
    assert.equal(response.status, 415, `content type ${type ?? 'none'}`)
    assert.deepEqual(await response.json(), { error: 'unsupported-media-type' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(request.bodyUsed, false, 'the body is never read')
  }
  assert.equal(ran, 0, 'the handler never ran')
  for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;Charset=UTF-8', ' application/json ']) {
    assert.equal((await call('POST', type)).response.status, 200, `content type ${type}`)
  }
  assert.equal((await call('GET')).response.status, 200, 'a GET needs no content type')
  assert.equal(ran, 5)
})
