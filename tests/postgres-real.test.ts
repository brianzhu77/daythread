import { test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { stepsKey, writeSteps } from '../src/domain/buttons.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import { postgresClient } from '../src/server/db/sql.ts'

// The Postgres store (rows, shot 2) through postgres-js on a real Postgres, as Vercel runs it: separate connections, prepare: false.
// Skipped unless DATABASE_TEST_URL points at a disposable database (its `daythread_test_*` schemas are dropped).
const url = process.env.DATABASE_TEST_URL
const skip = url ? false : 'DATABASE_TEST_URL not set'
const connect = () => postgres(url!, { prepare: false, max: 4, onnotice: () => {} })

test('real Postgres: two processes racing at the same revision, one wins and nothing is lost', { skip }, async () => {
  const schema = `daythread_test_${process.pid}`
  const [a, b] = [connect(), connect()]
  try {
    const [ra, rb] = [new PostgresWorkspaceRepository(postgresClient(a), schema), new PostgresWorkspaceRepository(postgresClient(b), schema)]
    // Both start up at once: the schema is created once, the row exists once.
    await Promise.all([ra.load(), rb.load()])
    const results = await Promise.allSettled([ra, rb].map((r, i) => r.execute({ operationId: `race-${i}`, expectedRevision: 0, action: { type: 'ensure-day', date: `2026-10-2${i}` } })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, String(results.map(r => r.status === 'rejected' ? r.reason : 'ok')))
    const after = await rb.load()
    assert.equal(after.revision, 1)
    await rb.execute({ operationId: 'next', expectedRevision: 1, action: { type: 'ensure-day', date: '2026-10-25' } })
    assert.equal((await ra.load()).pages.length, 2)
    const text = 'nul \u0000 · 🧵 · 中文'
    const page = (await ra.load()).pages[0]!
    await ra.execute({ operationId: 't', expectedRevision: 2, action: { type: 'add-task', pageId: page.id, title: text, plannedOn: page.date } })
    assert.equal((await rb.load()).tasks[0]!.title, text.replace('\u0000', ''), 'everything but U+0000, which a text column refuses')
  } finally {
    await a.unsafe(`drop schema if exists daythread_test_${process.pid} cascade`)
    await Promise.all([a.end(), b.end()])
  }
})

test('real Postgres: two processes starting on a schema without the database columns add them once; values round-trip', { skip }, async () => {
  const schema = `daythread_test_db_${process.pid}`
  const [a, b] = [connect(), connect()]
  try {
    await new PostgresWorkspaceRepository(postgresClient(a), schema).load()
    await a.unsafe(`alter table ${schema}.pages drop column database_json, drop column row_values, drop column created_at, drop column edited_at`)
    const [ra, rb] = [new PostgresWorkspaceRepository(postgresClient(a), schema), new PostgresWorkspaceRepository(postgresClient(b), schema)]
    await Promise.all([ra.load(), rb.load()])
    const at = '2026-10-22T18:00:00.000Z'
    await ra.execute({ operationId: 'd1', expectedRevision: 0, action: { type: 'create-database', pageId: 'list', homeBlockId: null, title: 'Reading list' } })
    await ra.execute({ operationId: 'd2', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } } } })
    await ra.execute({ operationId: 'd3', expectedRevision: 2, action: { type: 'add-row', databaseId: 'list', pageId: 'dune', title: 'Dune', values: { due: { start: '2026-10-25', end: '2026-10-27' } }, at } })
    const row = (await rb.load()).pages.find(p => p.id === 'dune')!
    assert.deepEqual(row.values, { due: { start: '2026-10-25', end: '2026-10-27' } })
    assert.equal(row.createdAt, at)
    assert.equal((await rb.load()).pages.find(p => p.id === 'list')!.database!.properties[0]!.name, 'Due')
  } finally {
    await a.unsafe(`drop schema if exists daythread_test_db_${process.pid} cascade`)
    await Promise.all([a.end(), b.end()])
  }
})

test('real Postgres: a row number is never used twice, past an Undo', { skip }, async () => {
  const schema = `daythread_test_ids_${process.pid}`
  const a = connect()
  try {
    const r = new PostgresWorkspaceRepository(postgresClient(a), schema)
    let ws = await r.load()
    const run = async (operationId: string, action: never) => { const out = await r.execute({ operationId, expectedRevision: ws.revision, action }); ws = await r.load(); return out }
    await run('i1', { type: 'create-database', pageId: 'list', homeBlockId: null, title: 'List' } as never)
    await run('i2', { type: 'add-row', databaseId: 'list', pageId: 'one', title: 'One', at: '2026-10-22T18:00:00.000Z' } as never)
    await run('i3', { type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } } } as never)
    await run('i4', { type: 'add-row', databaseId: 'list', pageId: 'two', title: 'Two', at: '2026-10-22T18:00:00.000Z' } as never)
    assert.equal(ws.pages.find(p => p.id === 'two')!.values!['@id'], 2)
    await run('i5', { type: 'undo', targetOperationId: 'i4' } as never)
    assert.equal(ws.pages.some(p => p.id === 'two'), false)
    assert.equal(ws.pages.find(p => p.id === 'list')!.database!.nextRowNumber, 3)
    await run('i6', { type: 'add-row', databaseId: 'list', pageId: 'three', title: 'Three', at: '2026-10-22T18:00:00.000Z' } as never)
    assert.equal(ws.pages.find(p => p.id === 'three')!.values!['@id'], 3)
    assert.equal(ws.pages.find(p => p.id === 'one')!.values!['@id'], 1)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

test('real Postgres: moving a parent takes its tree in one operation, and one Undo puts all of it back', { skip }, async () => {
  const schema = `daythread_test_move_${process.pid}`
  const a = connect()
  try {
    const r = new PostgresWorkspaceRepository(postgresClient(a), schema), at = '2026-10-22T18:00:00.000Z'
    let ws = await r.load()
    const run = async (operationId: string, action: never) => { await r.execute({ operationId, expectedRevision: ws.revision, action }); ws = await r.load() }
    const values = (id: string) => ws.pages.find(p => p.id === id)!.values
    await run('m1', { type: 'create-database', pageId: 'from', homeBlockId: null, title: 'From' } as never)
    await run('m2', { type: 'create-database', pageId: 'to', homeBlockId: null, title: 'To' } as never)
    await run('m3', { type: 'change-database', pageId: 'from', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } } as never)
    for (const id of ['top', 'kid', 'grand']) await run(`add-${id}`, { type: 'add-row', databaseId: 'from', pageId: id, title: id, at } as never)
    await run('m4', { type: 'set-values', pageId: 'kid', values: { par: ['top'] }, expected: {}, at } as never)
    await run('m5', { type: 'set-values', pageId: 'grand', values: { par: ['kid'] }, expected: {}, at } as never)
    const before = ['top', 'kid', 'grand'].map(values)
    await run('move', { type: 'move-row', pageId: 'top', databaseId: 'to', at } as never)
    assert.deepEqual(['top', 'kid', 'grand'].map(id => ws.pages.find(p => p.id === id)!.parentId), ['to', 'to', 'to'])
    const { parent, sub } = ws.pages.find(p => p.id === 'to')!.database!.subItems!
    assert.deepEqual(values('grand')![parent], ['kid'])
    assert.deepEqual(values('top')![sub], ['kid'])
    await run('back', { type: 'undo', targetOperationId: 'move' } as never)
    assert.deepEqual(['top', 'kid', 'grand'].map(id => ws.pages.find(p => p.id === id)!.parentId), ['from', 'from', 'from'])
    assert.deepEqual(['top', 'kid', 'grand'].map(values), before)
    assert.equal(ws.pages.find(p => p.id === 'to')!.database!.subItems, undefined)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

test('real Postgres: several to-dos in one command, and one Undo brings back every task and page', { skip }, async () => {
  const schema = `daythread_test_todos_${process.pid}`
  const a = connect()
  try {
    const r = new PostgresWorkspaceRepository(postgresClient(a), schema)
    let ws = await r.load()
    const run = async (operationId: string, action: never) => { await r.execute({ operationId, expectedRevision: ws.revision, action }); ws = await r.load() }
    await run('d1', { type: 'ensure-day', date: '2026-11-04' } as never)
    await run('t1', { type: 'add-task', pageId: 'day:2026-11-04', title: 'One', plannedOn: '2026-11-04' } as never)
    await run('t2', { type: 'add-task', pageId: 'day:2026-11-04', title: 'Two', plannedOn: '2026-11-04' } as never)
    const ids = ws.tasks.filter(t => t.title).map(t => t.id)
    await run('some', { type: 'edit-todos', today: '2026-11-04', items: ids.map(taskId => ({ taskId, changes: [{ columnId: 'planned', value: { start: '2026-11-05' } }] })) } as never)
    const onDay = (date: string) => ws.pages.find(p => p.date === date)?.document ?? ''
    for (const id of ids) assert.ok(onDay('2026-11-05').includes(id))
    await run('back', { type: 'undo', targetOperationId: 'some' } as never)
    for (const id of ids) { assert.ok(onDay('2026-11-04').includes(id)); assert.equal(onDay('2026-11-05').includes(id), false) }
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})


test('real Postgres: comments in their own table, a page save leaves them, a replay isn\'t made twice, Undo brings one back, a late Undo is refused, and another account reads none', { skip }, async () => {
  const schema = `daythread_test_comments_${process.pid}`, a = connect()
  const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
  try {
    const repo = new PostgresWorkspaceRepository(postgresClient(a), schema)
    await repo.workspaceIdFor(owner); await repo.workspaceIdFor(other)
    await asOwner(owner, async () => {
      let ws = await repo.load()
      const run = async (operationId: string, action: unknown) => { ws = (await repo.execute({ operationId, expectedRevision: ws.revision, action: action as never })).workspace }
      const at = '2026-11-05T10:00:00.000Z', stored = () => a.unsafe(`select id, version, resolved_at, comments::text as comments from ${schema}.comment_threads`)
      await run('page', { type: 'create-document', title: 'Trip', body: 'Words', pageId: 'p' })
      const add = { type: 'add-comment', pageId: 'p', threadId: 't', commentId: 'c', body: 'nul \u0000 · 🧵 · 中文', at }
      await run('add', add)
      await repo.execute({ operationId: 'add', expectedRevision: ws.revision, action: add as never })
      ws = await repo.load()
      assert.equal(ws.threads?.[0]?.comments.length, 1)
      assert.equal(ws.threads?.[0]?.comments[0]?.body, 'nul  · 🧵 · 中文', 'everything but U+0000, which a text column refuses')
      const before = await stored()
      await run('rename', { type: 'rename-page', pageId: 'p', title: 'Trip 2' })
      assert.deepEqual(await stored(), before)
      await run('resolve', { type: 'resolve-thread', threadId: 't', resolved: true, version: 1, at })
      assert.ok((await stored())[0]!.resolved_at)
      await run('back', { type: 'undo', targetOperationId: 'resolve' })
      assert.equal((await stored())[0]!.resolved_at, null)
      await run('gone', { type: 'delete-comment', threadId: 't', commentId: 'c', version: ws.threads![0]!.version })
      assert.equal((await stored()).length, 0)
      await run('again', { type: 'undo', targetOperationId: 'gone' })
      assert.equal((await stored()).length, 1)
      await run('resolve2', { type: 'resolve-thread', threadId: 't', resolved: true, version: ws.threads![0]!.version, at })
      await run('reply', { type: 'add-comment', pageId: 'p', threadId: 't', commentId: 'c2', body: 'Newer', at })
      await assert.rejects(run('late', { type: 'undo', targetOperationId: 'resolve2' }), /Cannot undo after later changes/)
      assert.equal((await repo.load()).threads?.[0]?.comments.length, 2)
      await run('other', { type: 'create-document', title: 'Other', body: 'Keep', pageId: 'o' })
      await run('trash', { type: 'delete-page', pageId: 'o', at })
      await run('jot', { type: 'add-comment', pageId: 'p', threadId: 't2', commentId: 'j', body: 'Jotted after', at })
      assert.equal((await repo.load()).undo?.operationId, 'trash')
      await run('untrash', { type: 'undo', targetOperationId: 'trash' })
      assert.equal(ws.pages.find(p => p.id === 'o')!.trashedAt, undefined)
      assert.equal(ws.threads?.find(t => t.id === 't2')?.comments[0]?.body, 'Jotted after')
    })
    await asOwner(other, async () => {
      const ws = await repo.load()
      assert.equal(ws.threads, undefined)
      await assert.rejects(repo.execute({ operationId: 'theirs', expectedRevision: ws.revision, action: { type: 'delete-comment', threadId: 't', commentId: 'c', version: 1 } as never }), /gone/)
    })
    assert.equal((await a.unsafe(`select count(*)::int as n from ${schema}.comment_threads`))[0]!.n, 2)
    assert.equal((await a.unsafe(`select relrowsecurity from pg_class where oid = '${schema}.comment_threads'::regclass`))[0]!.relrowsecurity, true)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

test('real Postgres: a button\'s steps in one operation, all or none, one Undo, and a retry makes one row', { skip }, async () => {
  const schema = `daythread_test_button_${process.pid}`, a = connect()
  try {
    const repo = new PostgresWorkspaceRepository(postgresClient(a), schema)
    let ws = await repo.load()
    const run = async (operationId: string, action: unknown) => { ws = (await repo.execute({ operationId, expectedRevision: ws.revision, action: action as never })).workspace; return ws }
    const at = '2026-11-05T10:00:00.000Z', today = '2026-11-05'
    await run('db', { type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
    await run('n', { type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
    await run('r1', { type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at })
    await run('p', { type: 'create-document', title: 'Notes', body: '', pageId: 'p' })
    const steps = writeSteps([
      { id: 'i', kind: 'insert', place: 'below', blocks: [{ id: 'x', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Inserted', styles: {} }], children: [] }, { id: 't', type: 'checkListItem', props: {}, content: [{ type: 'text', text: 'To do', styles: {} }], children: [] }] },
      { id: 'a', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Made', set: [] },
      { id: 'e', kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [], set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: 9 } }] },
    ])
    const key = () => pageContentKey(ws.pages.find(p => p.id === 'p')!)
    await run('save', { type: 'save-editor', pageId: 'p', expectedContent: key(), document: JSON.stringify([{ id: 'btn', type: 'button', props: { label: 'Go', steps }, children: [] }]) })
    const before = JSON.stringify([ws.pages.find(p => p.id === 'p')!.document, ws.tasks.length, ws.pages.length])
    const tap = { type: 'run-button', pageId: 'p', blockId: 'btn', stepsKey: stepsKey(steps), expectedContent: key(), at, today }
    await run('tap', tap)
    const rows = () => ws.pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
    assert.equal(rows().length, 2)
    assert.deepEqual(rows().map(r => r.values?.n), [9, 9])
    assert.equal(ws.tasks.filter(t => t.title === 'To do').length, 1)
    await repo.execute({ operationId: 'tap', expectedRevision: ws.revision, action: tap as never })
    ws = await repo.load()
    assert.equal(rows().length, 2, 'a retry after a lost reply makes one row')
    await run('back', { type: 'undo', targetOperationId: 'tap' })
    assert.equal(JSON.stringify([ws.pages.find(p => p.id === 'p')!.document, ws.tasks.length, ws.pages.length]), before)
    assert.deepEqual(rows().map(r => r.values?.n), [1])
    // A failing step leaves nothing behind in any table.
    const bad = writeSteps([{ id: 'a', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'No', set: [] }, { id: 'e', kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [], set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: 'words' } }] }])
    await run('save2', { type: 'save-editor', pageId: 'p', expectedContent: key(), document: JSON.stringify([{ id: 'btn', type: 'button', props: { label: 'Go', steps: bad }, children: [] }]) })
    const count = (await a.unsafe(`select count(*)::int as n from ${schema}.pages`))[0]!.n, revision = ws.revision
    await assert.rejects(run('bad', { type: 'run-button', pageId: 'p', blockId: 'btn', stepsKey: stepsKey(bad), expectedContent: key(), at, today }), /Edit rows in Runs/)
    assert.equal((await a.unsafe(`select count(*)::int as n from ${schema}.pages`))[0]!.n, count)
    assert.equal((await repo.load()).revision, revision)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

test('real Postgres: a rule inside his edit, one Undo over both, a failed rule dropped whole with his edit kept, and a retry not evaluating again', { skip }, async () => {
  const schema = `daythread_test_rules_${process.pid}`, a = connect()
  try {
    const repo = new PostgresWorkspaceRepository(postgresClient(a), schema)
    let ws = await repo.load()
    const run = async (operationId: string, action: unknown) => { const r = await repo.execute({ operationId, expectedRevision: ws.revision, action: action as never }); ws = r.workspace; return r }
    const at = '2026-11-05T10:00:00.000Z', C = (id: string, change: unknown) => run(id, { type: 'change-database', pageId: 'runs', change })
    await run('db', { type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
    await C('n', { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
    await C('m', { kind: 'addProperty', property: { id: 'm', name: 'M', type: 'number' } })
    await run('r1', { type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at })
    const set = (raw: unknown) => writeSteps([{ id: 'a', kind: 'edit-property', set: [{ id: 'm', name: 'M', value: { kind: 'fixed', raw: 5 } }] }, ...(raw === null ? [] : [{ id: 'b', kind: 'edit-property', set: [{ id: 'm', name: 'M', value: { kind: 'fixed', raw } }] }])] as never)
    await C('good', { kind: 'addAutomation', automation: { id: 'good', name: 'Good', active: true, triggers: [{ kind: 'property-edited', propertyId: 'n', name: 'N' }], steps: set(null) } })
    const row = () => ws.pages.find(p => p.id === 'r1')!
    const edit = { type: 'set-values', pageId: 'r1', values: { n: 2 }, expected: { n: 1 }, at }
    const first = await run('edit', edit)
    assert.equal(row().values?.m, 5)
    assert.deepEqual(first.receipt.automations?.ran, ['Good'])
    await repo.execute({ operationId: 'edit', expectedRevision: ws.revision, action: edit as never })
    ws = await repo.load()
    assert.equal(ws.pages.find(p => p.id === 'runs')!.database!.automations![0]!.lastRanAt !== undefined, true)
    await run('back', { type: 'undo', targetOperationId: 'edit' })
    assert.deepEqual([row().values?.n, row().values?.m ?? null], [1, null], 'one Undo over both')
    await C('swap', { kind: 'updateAutomation', automation: { id: 'good', name: 'Good', active: true, triggers: [{ kind: 'property-edited', propertyId: 'n', name: 'N' }], steps: set('words') } })
    const failed = await run('edit2', { ...edit })
    assert.equal(row().values?.n, 2, 'his edit stands')
    assert.equal(row().values?.m ?? null, null, 'the first step of the failed rule is gone too')
    assert.equal(failed.receipt.automations?.paused[0]?.name, 'Good')
    const stored = await repo.load()
    assert.equal(stored.pages.find(p => p.id === 'runs')!.database!.automations![0]!.active, false, 'the pause is stored with his edit')
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})
