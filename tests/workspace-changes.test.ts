// A command's reply carries what it changed (src/domain/workspace-changes.ts): applied to the browser's copy it must
// give exactly the workspace the server would have sent whole, on both stores, for every kind of change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { replyWorkspace } from '../src/components/command-reply.ts'
import { editorSeed, pageContentKey } from '../src/domain/editor-document.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import type { ServerRepository } from '../src/server/repository.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
import { harness, today, dayId, todo, para } from './v2-helpers.ts'

const day = dayId(today)
/** One of each kind of change: new pages, a reorder, an edit, tasks made, ticked and deleted (a tombstone), trash and restore, the time zone, Undo. */
function script(ws: () => Workspace): ((n: number) => Action)[] {
  const doc = (pageId: string) => editorSeed(ws().pages.find(p => p.id === pageId)!, ws())
  const save = (pageId: string, edit: (d: ReturnType<typeof doc>) => unknown[]): Action =>
    ({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws().pages.find(p => p.id === pageId)!), document: JSON.stringify(edit(structuredClone(doc(pageId)))), today })
  return [
    () => ({ type: 'ensure-day', date: today }),
    () => ({ type: 'create-document', title: 'Books', body: '', pageId: 'books' }),
    () => ({ type: 'create-document', title: 'Dune', body: '', pageId: 'dune', parentId: 'books' }),
    () => ({ type: 'create-document', title: 'Emma', body: '', pageId: 'emma', parentId: 'books' }),
    () => ({ type: 'move-page', pageId: 'emma', parentId: 'books', beforeId: 'dune' }),
    () => save(day, d => [...d, todo('r1', 'Read Dune'), todo('r2', 'Return Emma'), para('p1')]),
    () => ({ type: 'task-status', taskId: ws().tasks.find(t => t.title === 'Read Dune')!.id, status: 'done', today }),
    () => save(day, d => d.filter(n => n.id !== 'r2')),
    () => ({ type: 'rename-page', pageId: 'dune', title: 'Dune (1965)' }),
    () => ({ type: 'delete-page', pageId: 'books', at: '2026-10-22T18:00:00Z' }),
    () => ({ type: 'restore-page', pageId: 'books' }),
    () => ({ type: 'set-timezone', timezone: 'Asia/Shanghai' }),
    () => ({ type: 'move-page', pageId: 'dune', parentId: null }),
    n => ({ type: 'undo', targetOperationId: `op-${n - 1}` }),
  ]
}

test('domain: every change applied to the copy before it gives the copy after it', () => {
  const h = harness()
  const steps = script(() => h.ws)
  steps.forEach((step, i) => {
    const before = forBrowser(h.ws)
    const { workspace } = h.run(step(i + 1))
    const changes = changesBetween(before, workspace)
    assert.deepEqual(applyChanges(before, changes), forBrowser(workspace), `step ${i + 1}`)
  })
})

test('domain: only what changed is sent, and the order only when it moved', () => {
  const h = harness()
  for (const [i, step] of script(() => h.ws).slice(0, 4).entries()) h.run(step(i + 1))
  const before = forBrowser(h.ws)
  const renamed = changesBetween(before, h.run({ type: 'rename-page', pageId: 'dune', title: 'Dune (novel)' }).workspace)
  assert.deepEqual(renamed.pages.upsert.map(p => p.id), ['dune'])
  assert.equal(renamed.pages.order, undefined)
  assert.deepEqual([renamed.tasks.upsert, renamed.tasks.remove, renamed.deletedTasks], [[], [], undefined])
  const moved = changesBetween(forBrowser(h.ws), h.run({ type: 'move-page', pageId: 'emma', parentId: 'books', beforeId: 'dune' }).workspace)
  assert.ok(moved.pages.order, 'a reorder sends the order')
})

test('domain: a copy at another revision gets null (the browser loads instead)', () => {
  const h = harness()
  const before = forBrowser(h.ws)
  const changes = changesBetween(before, h.run({ type: 'ensure-day', date: today }).workspace)
  assert.equal(applyChanges({ ...before, revision: before.revision + 1 }, changes), null)
  // A replay changes nothing and starts from the current revision, which a tab whose reply was lost doesn't have.
  const replay = changesBetween(h.ws, h.ws)
  assert.equal(applyChanges(before, replay), null)
})

const stores: [string, () => Promise<{ repo: ServerRepository; cleanup(): Promise<void> }>][] = [
  ['SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dt-changes-'))
    return { repo: new SqliteWorkspaceRepository(join(dir, 'ws.sqlite'), undefined, { today }), cleanup: async () => rmSync(dir, { recursive: true, force: true }) }
  }],
  ['Postgres (PGlite)', async () => {
    const db = await PGlite.create()
    return { repo: new PostgresWorkspaceRepository(pgliteClient(db), undefined, { today }), cleanup: () => db.close() }
  }],
]
for (const [name, open] of stores) {
  test(`${name}: each reply's changes, applied to the loaded copy, equal the workspace loaded after it`, async () => {
    const { repo, cleanup } = await open()
    try {
      let copy = forBrowser(await repo.load())
      const steps = script(() => copy)
      for (const [i, step] of steps.entries()) {
        const n = i + 1, result = await repo.execute({ operationId: `op-${n}`, expectedRevision: copy.revision, action: step(n) })
        const applied = applyChanges(copy, result.changes)
        const loaded = forBrowser(await repo.load())
        assert.deepEqual(applied, loaded, `step ${n}`)
        assert.deepEqual(applied, forBrowser(result.workspace), `step ${n}: same as the whole reply`)
        copy = applied!
      }
      // The last command again (its reply lost): a replay, whose changes don't apply to the copy from before it.
      const last = steps.length, replay = await repo.execute({ operationId: `op-${last}`, expectedRevision: copy.revision - 1, action: steps[last - 1]!(last) })
      assert.equal(replay.changes.revision, copy.revision)
      assert.equal(applyChanges({ ...copy, revision: copy.revision - 1 }, replay.changes), null)
    } finally { await cleanup() }
  })
}

test('browser: a reply from another account is never applied, even at the same revision (Lead 6f528f6e)', () => {
  const mine = harness(), theirs = harness()
  mine.run({ type: 'create-document', title: 'My page', body: '', pageId: 'mine' })
  theirs.run({ type: 'create-document', title: 'Their page', body: '', pageId: 'theirs' })
  const copy = forBrowser(mine.ws)
  const before = forBrowser(theirs.ws)
  const changes = changesBetween(before, theirs.run({ type: 'rename-page', pageId: 'theirs', title: 'Theirs' }).workspace)
  assert.equal(copy.revision, changes.from, 'the revisions match, so only the owner tells them apart')
  assert.equal(replyWorkspace(copy, { owner: 'b', changes }, 'a'), null)
  assert.equal(replyWorkspace(copy, { owner: 'a', changes }, null), null, 'owner not known yet: load')
  const own = changesBetween(copy, mine.run({ type: 'rename-page', pageId: 'mine', title: 'Mine' }).workspace)
  assert.ok(replyWorkspace(copy, { owner: 'a', changes: own }, 'a'))
  // A whole workspace (an older server) replaces the copy, whoever it belongs to, as before.
  assert.deepEqual(replyWorkspace(copy, { owner: 'b', workspace: before }, 'a'), before)
})
