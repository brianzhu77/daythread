// Repeating to-dos in storage (docs/design/repeating-to-dos.md): a repeat is a row of its own table, which an older build never
// reads, so its saves and Undo leave repeats alone; the browser's changes and the outbox's row check carry it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { predictedWrites } from '../src/components/outbox.ts'
import type { TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import { changesBetween, applyChanges } from '../src/domain/workspace-changes.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { writeKeys } from '../src/server/outbox-replay.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', nextMon = '2026-11-30'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }
const biweekly: TodoRepeatRule = { every: 'week', interval: 2, from: 'schedule', weekdays: [1, 4], until: '2027-01-01' }

/** Two to-dos on Monday, each repeating: the first weekly, the second every other week. Nothing ticked yet. */
function setup() {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), () => [todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Pay rent', 'plan', mon)], { today: mon })
  const first = h.task('Weekly review').id, second = h.task('Pay rent').id
  h.run({ type: 'set-todo-repeat', taskId: second, repeat: biweekly, today: mon, at })
  return { h, first, second }
}
const tick = (taskId: string) => ({ type: 'task-status', taskId, status: 'done', today: mon }) as const

test('repeats go through the rows and back, an inverse from before them leaves them, and the browser\'s changes carry them', () => {
  const { h, first, second } = setup()
  assert.equal(workspaceOf(rowsOf(harness().ws)).todoRepeats, undefined, 'none stored, none read')
  h.run({ type: 'set-todo-repeat', taskId: first, repeat: weekly, today: mon, at })
  const before = h.ws, rows = rowsOf(before)
  assert.equal(before.todoRepeats?.length, 2)
  assert.deepEqual(workspaceOf(rows).todoRepeats?.map(r => r.id).sort(), before.todoRepeats!.map(r => r.id).sort())
  assert.deepEqual(workspaceOf(rows).todoRepeats, [...before.todoRepeats!].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
  assert.deepEqual(workspaceOf(rows).todoRepeats!.find(r => r.every === 'week' && r.interval === 2), before.todoRepeats!.find(r => r.interval === 2), 'weekdays and until come back')
  assert.deepEqual(Object.keys(workspaceOf(rows).todoRepeats!.find(r => r.interval === 1)!).sort(), ['createdAt', 'every', 'from', 'id', 'interval', 'slot', 'start', 'taskId'], 'absent fields stay absent')

  h.run(tick(first))
  const after = h.ws
  assert.equal(after.todoRepeats!.find(r => r.start === mon && r.interval === 1)!.previous?.taskId, first)
  const { write, inverse } = planWrites(rows, after)
  assert.equal(write.repeats?.upsert.length, 1)
  assert.equal(write.repeats?.remove.length, 0)
  assert.equal(inverse.repeats?.upsert.length, 1)
  assert.deepEqual(inverse.repeats!.upsert[0], rows.repeats!.find(r => r.id === write.repeats!.upsert[0]!.id), 'the inverse puts the row back as it was')
  const written = applyDiff(rows, write)
  assert.deepEqual(workspaceOf(written).todoRepeats, after.todoRepeats!.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
  assert.deepEqual(workspaceOf(applyDiff(written, inverse)).todoRepeats, workspaceOf(rows).todoRepeats)
  const { repeats: _none, ...older } = inverse
  assert.deepEqual(workspaceOf(applyDiff(written, older)).todoRepeats, workspaceOf(written).todoRepeats, 'an older build\'s Undo leaves the repeats alone')

  const changes = changesBetween(before, after)
  assert.deepEqual(applyChanges(before, changes)!.todoRepeats, after.todoRepeats)
  assert.equal(changesBetween(before, before).todoRepeats, undefined, 'unchanged repeats are not sent')
  assert.ok(second)
  // A last one finished that made no next: the day it was finished goes through the rows and back.
  const ended = harness(); ended.day(mon)
  ended.save(dayId(mon), () => [todo('e-1', 'Last time', 'plan', mon)], { today: mon })
  ended.run({ type: 'set-todo-repeat', taskId: ended.task('Last time').id, repeat: { ...weekly, until: mon }, today: mon, at })
  ended.run(tick(ended.task('Last time').id))
  assert.equal(ended.ws.todoRepeats![0]!.finishedOn, mon)
  assert.equal(rowsOf(ended.ws).repeats![0]!.finished_on, mon)
  assert.deepEqual(workspaceOf(rowsOf(ended.ws)).todoRepeats, ended.ws.todoRepeats)
  assert.equal(rowsOf(before).repeats!.every(r => r.finished_on === null), true, 'none recorded, null in the row')
  // Taking the last repeat off sends the empty list, and the other side then has none.
  const off = harness(); off.day(mon)
  off.save(dayId(mon), () => [todo('o-1', 'Once', 'plan', mon)], { today: mon })
  const on = off.ws
  off.run({ type: 'set-todo-repeat', taskId: off.task('Once').id, repeat: weekly, today: mon, at })
  const withRepeat = off.ws
  off.run({ type: 'set-todo-repeat', taskId: off.task('Once').id, repeat: null, today: mon, at })
  assert.equal(applyChanges(withRepeat, changesBetween(withRepeat, off.ws))!.todoRepeats, undefined)
  assert.equal(applyChanges(on, changesBetween(on, on))!.todoRepeats, undefined)
})

test('the row check sees a repeat', () => {
  const { h, first } = setup()
  h.run({ type: 'set-todo-repeat', taskId: first, repeat: weekly, today: mon, at })
  const before = h.ws, rows = rowsOf(before)
  const receipt = h.run(tick(first)).receipt
  const nextId = receipt.nextTodos![0]!.taskId
  const repeatId = h.ws.todoRepeats!.find(r => r.taskId === nextId)!.id
  assert.ok(writeKeys(planWrites(rows, h.ws).write).includes(`repeat:${repeatId}`))
  const predicted = predictedWrites(before, h.ws)
  assert.ok(predicted.includes(`repeat:${repeatId}`))
  assert.ok(predicted.includes(`task:${nextId}`))
})

const A = '11111111-1111-4111-8111-111111111111'
test('on the database: a schema from before gets the table, the repeat survives a restart, and Undo comes from the inverse', async () => {
  const db = await PGlite.create(), sql = pgliteClient(db)
  const first = new PostgresWorkspaceRepository(sql, undefined, { today: mon })
  await first.prepare()
  await db.query('drop table daythread.todo_repeats')
  const repo = new PostgresWorkspaceRepository(sql, undefined, { today: mon })
  await repo.prepare()
  assert.deepEqual((await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = 'daythread.todo_repeats'::regclass`)).rows, [{ relrowsecurity: true }])
  await repo.workspaceIdFor(A)
  await asOwner(A, async () => {
    let w = await repo.load()
    const run = async (action: unknown) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: action as never }); w = r.workspace as typeof w; return r }
    await run({ type: 'ensure-day', date: mon })
    const made = await run({ type: 'add-task', pageId: `day:${mon}`, title: 'Weekly review', plannedOn: mon })
    const taskId = made.receipt.entityId!
    await run({ type: 'set-todo-repeat', taskId, repeat: weekly, today: mon, at })
    const done = await run(tick(taskId))
    const nextId = done.receipt.nextTodos![0]!.taskId
    assert.equal(done.receipt.nextTodos![0]!.on, nextMon)
    const stored = (await repo.load()).todoRepeats!
    assert.equal(stored.length, 1)
    assert.equal(stored[0]!.taskId, nextId)
    assert.equal(stored[0]!.previous?.taskId, taskId)
    // A second instance (a restart) reads the same.
    const again = await new PostgresWorkspaceRepository(sql, undefined, { today: mon }).load()
    assert.deepEqual(again.todoRepeats, stored)
    assert.ok(again.tasks.some(t => t.id === nextId))
    // Undo of the tick puts the repeat back on the first to-do.
    await run({ type: 'undo', targetOperationId: done.receipt.operationId })
    const undone = (await repo.load()).todoRepeats!
    assert.equal(undone.length, 1)
    assert.equal(undone[0]!.taskId, taskId)
    assert.equal(undone[0]!.previous, undefined)
    // Tick again, then Undo with an inverse as a build before repeats wrote it: the repeat is as the tick left it.
    const second = await run(tick(taskId))
    const left = (await repo.load()).todoRepeats
    const op = (await db.query<{ inverse: string }>('select inverse::text as inverse from daythread.operations where operation_id = $1', [second.receipt.operationId])).rows[0]!
    const inverse = JSON.parse(op.inverse)
    assert.ok(inverse.repeats, 'the tick stored the repeat in its inverse')
    delete inverse.repeats
    await db.query('update daythread.operations set inverse = $1::json where operation_id = $2', [JSON.stringify(inverse), second.receipt.operationId])
    await run({ type: 'undo', targetOperationId: second.receipt.operationId })
    assert.deepEqual((await repo.load()).todoRepeats, left)
  })
  await db.close()
})

test('SQLite keeps repeats in its document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-repeats-sqlite-')), path = join(dir, 'workspace.sqlite')
  try {
    const repo = new SqliteWorkspaceRepository(path, undefined, { today: mon })
    let w = await repo.load()
    const run = async (action: unknown) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: action as never }); w = r.workspace as typeof w; return r }
    await run({ type: 'ensure-day', date: mon })
    const taskId = (await run({ type: 'add-task', pageId: `day:${mon}`, title: 'Weekly review', plannedOn: mon })).receipt.entityId!
    await run({ type: 'set-todo-repeat', taskId, repeat: weekly, today: mon, at })
    const done = await run(tick(taskId))
    const loaded = await new SqliteWorkspaceRepository(path, undefined, { today: mon }).load()
    assert.equal(loaded.todoRepeats?.length, 1)
    assert.equal(loaded.todoRepeats![0]!.taskId, done.receipt.nextTodos![0]!.taskId)
    assert.deepEqual(loaded.todoRepeats, w.todoRepeats)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
