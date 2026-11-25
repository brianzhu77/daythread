import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import { commandReply, handleCommand, handleSave, haveOf, saveReply, workspaceReply } from '../src/server/api-v1.ts'

const dirs: string[] = []
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
  const body = { operationId: 'add', action: { type: 'add-task', pageId: 'day:2026-10-22', title: 'Water the plants' }, expectedOwner: 'local', basis: { baseRevision: 1, ownRevisions: [], readsBeyond: false } }
  const first = await commandReply(repo, 'local', body)
  assert.equal(first.status, 200); assert.equal(first.body.status, 'applied'); assert.equal(first.body.changes.from, 1)
  assert.equal((await commandReply(repo, 'local', body)).body.status, 'applied', 'a replay answers with its receipt')
  assert.equal((await commandReply(repo, 'someone-else', body)).body.status, 'owner-mismatch')
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
