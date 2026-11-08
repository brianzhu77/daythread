// Comments step 4 (comments.md §4, §6): a thread on one property of a row, its words kept for when the property's gone, following a move.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { commandSchema } from '../src/domain/command-schema.ts'
import { propertyQuote } from '../src/domain/comments.ts'
import { pageMarkdown } from '../src/domain/export.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
const stage = { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }, { id: 'b', name: 'Doing', color: 'gray' }] }
const on = (propertyId = 'st', quote = 'Idea') => ({ propertyId, name: 'Stage', quote })
function rows() {
  const h = harness()
  const C = (pageId: string, change: unknown) => h.run({ type: 'change-database', pageId, change } as never)
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Runs' })
  C('db', { kind: 'addProperty', property: stage })
  C('db', { kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: { st: 'a' }, at } as never)
  return { h, C }
}
const comment = (h: ReturnType<typeof harness>, threadId: string, property: unknown, pageId = 'r1') =>
  h.run({ type: 'add-comment', pageId, threadId, commentId: `${threadId}-c`, body: 'Why this stage?', at, property } as never)
const thread = (h: ReturnType<typeof harness>, id = 't1') => h.ws.threads?.find(t => t.id === id)

test('a thread on a property: stored with its id, name and words, and its words cut to a line quote\'s length', () => {
  const { h } = rows()
  assert.equal(comment(h, 't1', on('st', 'x'.repeat(400))).receipt.message, 'Comment added')
  assert.deepEqual({ ...thread(h)!.property!, quote: thread(h)!.property!.quote.length }, { propertyId: 'st', name: 'Stage', quote: 300 })
  assert.equal(thread(h)!.pageId, 'r1')
  assert.equal(thread(h)!.anchor, undefined)
})

test('refused on a property the row\'s database doesn\'t have, on a page that isn\'t a row, and on a line and a property at once', () => {
  const { h } = rows()
  h.run({ type: 'create-document', title: 'Trip', body: 'Words', pageId: 'p' })
  assert.throws(() => comment(h, 't1', on('nope')), /That property's gone/)
  assert.throws(() => comment(h, 't2', on(), 'p'), /Not a row/)
  assert.throws(() => h.run({ type: 'add-comment', pageId: 'r1', threadId: 't3', commentId: 'c', body: 'x', at, property: on(), anchor: { blockId: 'b', quote: '' } } as never), /not both/)
  assert.equal(h.ws.threads, undefined)
  const parse = (action: unknown) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action }).success
  assert.ok(parse({ type: 'add-comment', pageId: 'r1', threadId: 't', commentId: 'c', body: 'x', at, property: on() }))
  assert.equal(parse({ type: 'add-comment', pageId: 'r1', threadId: 't', commentId: 'c', body: 'x', at, property: { propertyId: 'st' } }), false)
})

test('a rename follows; a deleted property leaves the thread reading "Property removed" with its words, and Undo brings it back', () => {
  const { h, C } = rows()
  comment(h, 't1', on())
  C('db', { kind: 'updateProperty', propertyId: 'st', name: 'Phase' })
  assert.deepEqual(propertyQuote(thread(h)!.property!, h.page('db').database!.properties), { text: 'Phase: Idea', gone: false })
  const removed = C('db', { kind: 'removeProperty', propertyId: 'st' })
  assert.ok(thread(h), 'the thread stays')
  assert.deepEqual(propertyQuote(thread(h)!.property!, h.page('db').database!.properties), { text: 'Property removed · Stage: Idea', gone: true })
  h.run({ type: 'undo', targetOperationId: removed.receipt.operationId } as never)
  assert.equal(propertyQuote(thread(h)!.property!, h.page('db').database!.properties).gone, false)
})

test('moving the row: the thread goes to the property its value came along to, or an empty one\'s match; one left behind reads removed', () => {
  const { h, C } = rows()
  h.run({ type: 'create-database', pageId: 'db2', homeBlockId: null, title: 'Other' })
  C('db2', { kind: 'addProperty', property: { ...stage, id: 'st2', options: [{ id: 'z', name: 'Idea', color: 'gray' }] } })
  C('db2', { kind: 'addProperty', property: { id: 'note2', name: 'note', type: 'text' } })
  C('db', { kind: 'addProperty', property: { id: 'n', name: 'Miles', type: 'number' } })
  comment(h, 't1', on())
  comment(h, 't2', { propertyId: 'note', name: 'Note', quote: '' })
  comment(h, 't3', { propertyId: 'n', name: 'Miles', quote: '' })
  h.run({ type: 'set-values', pageId: 'r1', values: { n: 4 }, expected: {}, at } as never)
  const moved = h.run({ type: 'move-row', pageId: 'r1', databaseId: 'db2', at } as never)
  const props = h.page('db2').database!.properties
  assert.equal(thread(h, 't1')!.property!.propertyId, 'st2', 'its value came along')
  assert.equal(thread(h, 't2')!.property!.propertyId, 'note2', 'empty, so matched by name and type')
  assert.equal(propertyQuote(thread(h, 't3')!.property!, props).text, 'Property removed · Miles', 'Miles stayed behind')
  assert.ok(['t1', 't2', 't3'].every(id => thread(h, id)!.pageId === 'r1'))
  h.run({ type: 'undo', targetOperationId: moved.receipt.operationId } as never)
  assert.equal(thread(h, 't1')!.property!.propertyId, 'st', 'Undo puts it back')
})

test('export names the property it\'s on, and a duplicated row has no comments', () => {
  const { h } = rows()
  comment(h, 't1', on())
  assert.match(pageMarkdown(h.page('r1'), h.ws, new Map([['r1', 'One']])), /## Comments\n\n> Stage: Idea\n- .*Why this stage\?/)
  h.run({ type: 'duplicate-page', pageId: 'r1', newPageId: 'r1-copy', at } as never)
  assert.equal(h.ws.threads!.filter(t => t.pageId === 'r1-copy').length, 0)
})

test('rows: round-trips, and an inverse from a build before property threads keeps the property it has', () => {
  const { h } = rows()
  comment(h, 't1', on())
  const stored = rowsOf(h.ws)
  assert.deepEqual(workspaceOf(stored).threads![0]!.property, on())
  h.run({ type: 'resolve-thread', threadId: 't1', resolved: true, version: 1, at })
  const { inverse } = planWrites(stored, { ...h.ws, revision: h.ws.revision + 1 })
  const older = { ...inverse, threads: { ...inverse.threads!, upsert: inverse.threads!.upsert.map(({ property: _p, ...t }) => t) } }
  assert.deepEqual(workspaceOf(applyDiff(rowsOf(h.ws), older)).threads![0]!.property, on())
})

test('on the database: a schema from before gets the column, the thread round-trips, and an Undo an older build wrote keeps it', async () => {
  const db = await PGlite.create(), sql = pgliteClient(db)
  const first = new PostgresWorkspaceRepository(sql, undefined, { today })
  await first.prepare()
  await db.query('alter table daythread.comment_threads drop column property')
  const repo = new PostgresWorkspaceRepository(sql, undefined, { today })
  await repo.prepare()
  assert.equal((await db.query(`select 1 from information_schema.columns where table_schema = 'daythread' and table_name = 'comment_threads' and column_name = 'property'`)).rows.length, 1)
  const A = '11111111-1111-4111-8111-111111111111'
  await repo.workspaceIdFor(A)
  await asOwner(A, async () => {
    let w = await repo.load()
    const run = async (action: unknown) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: action as never }); w = r.workspace as typeof w; return r }
    await run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Runs' })
    await run({ type: 'change-database', pageId: 'db', change: { kind: 'addProperty', property: stage } })
    await run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: { st: 'a' }, at })
    await run({ type: 'add-comment', pageId: 'r1', threadId: 't1', commentId: 'c1', body: 'Why?', at, property: on() })
    assert.deepEqual(JSON.parse((await db.query<{ property: string }>('select property from daythread.comment_threads')).rows[0]!.property), on())
    const resolved = await run({ type: 'resolve-thread', threadId: 't1', resolved: true, version: 1, at })
    // Its inverse as a build before property threads would have written it.
    const op = (await db.query<{ inverse: string }>('select inverse::text as inverse from daythread.operations where operation_id = $1', [resolved.receipt.operationId])).rows[0]!
    const inverse = JSON.parse(op.inverse)
    for (const t of inverse.threads.upsert) delete t.property
    await db.query('update daythread.operations set inverse = $1::json where operation_id = $2', [JSON.stringify(inverse), resolved.receipt.operationId])
    await run({ type: 'undo', targetOperationId: resolved.receipt.operationId })
    const back = (await repo.load()).threads![0]!
    assert.equal(back.resolvedAt, undefined)
    assert.deepEqual(back.property, on())
  })
  await db.close()
})
