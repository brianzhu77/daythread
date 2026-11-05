import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { commandSchema } from '../src/domain/command-schema.ts'
import { commentLimit, threadsOn } from '../src/domain/comments.ts'
import { pageMarkdown } from '../src/domain/export.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { buildDayDraftRequest } from '../src/server/model/day-draft.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { planWrites, rowsOf, applyDiff, workspaceOf } from '../src/server/workspace-rows.ts'
import { dayId, harness, today } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z', later = '2026-11-05T11:00:00.000Z'
function noted() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Trip', body: 'Words', pageId: 'p' })
  h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c1', body: 'First note', at })
  return h
}
const thread = (h: ReturnType<typeof harness>, id = 't1') => h.ws.threads?.find(t => t.id === id)
test('a thread: added, replied to, edited, resolved and reopened, each moving its version; the page\'s document stays byte for byte', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Trip', body: 'Words', pageId: 'p' })
  const before = h.page('p').document, rev = h.page('p')
  assert.equal(h.ws.threads, undefined, 'absent until there\'s one')
  assert.equal(h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c1', body: '  First note ', at }).receipt.message, 'Comment added')
  assert.equal(thread(h)!.comments[0]!.body, 'First note')
  assert.equal(thread(h)!.version, 1)
  assert.equal(h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c2', body: 'A reply', at: later }).receipt.message, 'Reply added')
  assert.equal(thread(h)!.version, 2)
  assert.equal(h.run({ type: 'edit-comment', threadId: 't1', commentId: 'c1', body: 'Changed', version: 2, at: later }).receipt.message, 'Comment changed')
  assert.equal(thread(h)!.comments[0]!.editedAt, later)
  assert.equal(h.run({ type: 'resolve-thread', threadId: 't1', resolved: true, version: 3, at: later }).receipt.message, 'Resolved')
  assert.ok(thread(h)!.resolvedAt)
  assert.equal(h.run({ type: 'resolve-thread', threadId: 't1', resolved: false, version: 4, at: later }).receipt.message, 'Reopened')
  assert.equal('resolvedAt' in thread(h)!, false)
  assert.equal(h.page('p').document, before, 'a comment writes nothing to the page')
  assert.equal(h.page('p').title, rev.title)
})
test('a tab that hadn\'t seen the newest change is refused and changes nothing; too long and no words are refused', () => {
  const h = noted()
  h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c2', body: 'From the other tab', at: later })
  for (const stale of [
    { type: 'edit-comment', threadId: 't1', commentId: 'c1', body: 'Old view', version: 1, at: later },
    { type: 'delete-comment', threadId: 't1', commentId: 'c1', version: 1 },
    { type: 'resolve-thread', threadId: 't1', resolved: true, version: 1, at: later },
  ] as const) assert.throws(() => h.run(stale), /Changed elsewhere/, stale.type)
  assert.equal(thread(h)!.comments.length, 2)
  assert.equal(thread(h)!.comments[0]!.body, 'First note')
  assert.throws(() => h.run({ type: 'add-comment', pageId: 'p', threadId: 't2', commentId: 'c', body: 'x'.repeat(commentLimit + 1), at }), /2,000 characters at most/)
  assert.throws(() => h.run({ type: 'add-comment', pageId: 'p', threadId: 't2', commentId: 'c', body: '   ', at }), /needs words/)
  assert.throws(() => h.run({ type: 'add-comment', pageId: 'gone', threadId: 't2', commentId: 'c', body: 'x', at }))
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'delete-comment', threadId: 't1', commentId: 'c1', version: -1 } }).success, false)
})
test('deleting and resolving have one Undo; deleting the last comment takes the thread, and Undo brings it back; a late Undo can\'t erase a newer reply', () => {
  const h = noted()
  const gone = h.run({ type: 'delete-comment', threadId: 't1', commentId: 'c1', version: 1 })
  assert.equal(thread(h), undefined)
  assert.equal(h.ws.threads, undefined)
  h.run({ type: 'undo', targetOperationId: gone.receipt.operationId })
  assert.equal(thread(h)!.comments[0]!.body, 'First note')
  const resolved = h.run({ type: 'resolve-thread', threadId: 't1', resolved: true, version: 1, at: later })
  h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c2', body: 'Newer reply', at: later })
  assert.throws(() => h.run({ type: 'undo', targetOperationId: resolved.receipt.operationId }), /Cannot undo after later changes/)
  assert.equal(thread(h)!.comments.length, 2, 'the newer reply stands')
})
test('threads go to Trash with their page and come back; gone for good with it; a duplicate gets none; moving between days keeps them', () => {
  const h = noted()
  h.run({ type: 'delete-page', pageId: 'p', at })
  assert.equal(thread(h)!.pageId, 'p', 'it waits with the page')
  assert.equal(search(buildSearchIndex(h.ws), 'First', today).comments.length, 0, 'Trash isn\'t searched')
  h.run({ type: 'restore-page', pageId: 'p' })
  assert.equal(search(buildSearchIndex(h.ws), 'First', today).comments.length, 1)
  const d = harness()
  d.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Books' })
  d.run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: {}, at } as never)
  d.run({ type: 'add-comment', pageId: 'r1', threadId: 'r', commentId: 'c', body: 'On a row', at })
  d.run({ type: 'add-row', databaseId: 'db', pageId: 'r2', title: '', copyOf: 'r1', at } as never)
  assert.deepEqual(threadsOn(d.ws.threads, 'r2'), [])
  assert.equal(threadsOn(d.ws.threads, 'r1').length, 1)
  const day = harness()
  day.day(today)
  day.run({ type: 'delete-page', pageId: dayId(today), at })
  const trashed = day.ws.pages.find(p => p.trashedAt && p.date === today)!
  day.day(today)
  const newer = day.ws.pages.find(p => !p.trashedAt && p.date === today)!
  day.run({ type: 'add-comment', pageId: newer.id, threadId: 'on-new', commentId: 'c', body: 'On the new one', at })
  day.run({ type: 'restore-page', pageId: trashed.id })
  assert.equal(day.ws.threads?.[0]?.pageId, trashed.id, 'the note joins the day that came back')
})
test('search finds a comment\'s words, resolved too and marked; export writes them at the end; the day draft sends none (P2-8)', () => {
  const h = noted()
  h.run({ type: 'resolve-thread', threadId: 't1', resolved: true, version: 1, at: later })
  const hit = search(buildSearchIndex(h.ws), 'first note', today).comments
  assert.deepEqual(hit.map(c => [c.threadId, c.resolved, c.page.id]), [['t1', true, 'p']])
  const md = pageMarkdown(h.page('p'), h.ws, new Map([['p', 'Trip']]))
  assert.match(md, /## Comments\n\n- 2026-11-05 10:00 \(resolved\): First note/)
  const d = harness()
  d.day(today)
  d.run({ type: 'add-comment', pageId: dayId(today), threadId: 't', commentId: 'c', body: 'A private note', at })
  assert.equal(JSON.stringify(buildDayDraftRequest(d.ws, d.page(dayId(today))).messages).includes('A private note'), false)
})
test('the browser\'s copy follows, and a tab that knows nothing of them isn\'t handed anything it must use', () => {
  const h = noted(), before = structuredClone(h.ws)
  h.run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c2', body: 'Reply', at: later })
  const change = changesBetween(before, h.ws)
  assert.equal(change.threads?.[0]?.comments.length, 2)
  assert.equal(applyChanges(before, change)!.threads?.[0]?.comments.length, 2)
  const gone = h.run({ type: 'delete-comment', threadId: 't1', commentId: 'c2', version: 2 })
  assert.ok(gone)
  const rows = rowsOf(h.ws)
  assert.equal(workspaceOf(rows).threads?.[0]?.comments.length, 1)
})
test('an inverse written by a build before comments leaves the table alone (P2-9)', () => {
  const h = noted(), rows = rowsOf(h.ws)
  const { inverse } = planWrites(rows, { ...h.ws, revision: h.ws.revision + 1 })
  const { threads: _threads, ...older } = inverse
  assert.equal(applyDiff(rows, older).threads.length, 1)
})
test('on the database: a save of a page never touches them, Undo restores them, and another account reads none', async () => {
  const db = await PGlite.create(), sql = pgliteClient(db), repo = new PostgresWorkspaceRepository(sql, undefined, { today })
  await repo.prepare()
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
  await repo.workspaceIdFor(A); await repo.workspaceIdFor(B)
  await asOwner(A, async () => {
    let w = await repo.load()
    const run = async (action: never) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action }); w = r.workspace as typeof w; return r }
    await run({ type: 'create-document', title: 'Trip', body: 'Words', pageId: 'p' } as never)
    await run({ type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c1', body: 'Secret note', at } as never)
    const before = (await db.query<{ version: number; comments: string }>('select version, comments from daythread.comment_threads')).rows
    await run({ type: 'rename-page', pageId: 'p', title: 'Trip 2' } as never)
    assert.deepEqual((await db.query('select version, comments from daythread.comment_threads')).rows, before, 'a page\'s change writes nothing here')
    const lost = crypto.randomUUID(), again = { type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'c-lost', body: 'Answer lost', at }
    await repo.execute({ operationId: lost, expectedRevision: w.revision, action: again as never })
    w = await repo.load()
    await repo.execute({ operationId: lost, expectedRevision: w.revision, action: again as never })
    assert.deepEqual((await repo.load()).threads?.[0]?.comments.map(c => c.id), ['c1', 'c-lost'], 'a Retry of the same operation isn\'t made twice')
    w = await repo.load()
    const gone = await run({ type: 'delete-comment', threadId: 't1', commentId: 'c1', version: 2 } as never)
    assert.deepEqual((await repo.load()).threads?.[0]?.comments.map(c => c.id), ['c-lost'])
    await run({ type: 'undo', targetOperationId: gone.receipt.operationId } as never)
    assert.equal((await repo.load()).threads?.[0]?.comments[0]?.body, 'Secret note')
  })
  await asOwner(B, async () => {
    const w = await repo.load()
    assert.equal(w.threads, undefined)
    assert.equal(JSON.stringify(w).includes('Secret note'), false)
    await assert.rejects(repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'resolve-thread', threadId: 't1', resolved: true, version: 3, at } as never }), /gone/)
    await assert.rejects(repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'add-comment', pageId: 'p', threadId: 't1', commentId: 'x', body: 'y', at } as never }))
  })
  await db.close()
})
