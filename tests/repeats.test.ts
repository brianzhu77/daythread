// Repeating row templates (R4-6): each period once, whatever opens it; the latest only unless he asks for all; paused and deleted make nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Database, DatabaseChange, Repeat } from '../src/domain/database.ts'
import { rowTemplates } from '../src/domain/day-template.ts'
import { dueDates, dueRepeats, repeatRowId } from '../src/domain/repeats.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-04T10:00:00.000Z'
const r = (o: Partial<Repeat>): Repeat => ({ every: 'week', interval: 1, start: '2026-11-02', ...o })
test('occurrences: each kind and interval, and a month keeps its day where it can', () => {
  assert.deepEqual(dueDates(r({ every: 'day', interval: 2, start: '2026-11-01' }), '2026-11-06', '12:00'), ['2026-11-01', '2026-11-03', '2026-11-05'])
  assert.deepEqual(dueDates(r({}), '2026-11-16', '00:00'), ['2026-11-02', '2026-11-09', '2026-11-16'])
  assert.deepEqual(dueDates(r({ every: 'month', start: '2026-01-31' }), '2026-04-30', '09:00'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  assert.deepEqual(dueDates(r({ every: 'year', start: '2024-02-29' }), '2026-03-01', '09:00'), ['2024-02-29', '2025-02-28', '2026-02-28'])
})
test('a time holds it until then; what it has made and what came before it was set up are never due', () => {
  assert.deepEqual(dueDates(r({ start: '2026-11-04', time: '09:00' }), '2026-11-04', '08:59'), [])
  assert.deepEqual(dueDates(r({ start: '2026-11-04', time: '09:00' }), '2026-11-04', '09:00'), ['2026-11-04'])
  assert.deepEqual(dueDates(r({ last: '2026-11-09' }), '2026-11-16', '00:00'), ['2026-11-16'])
  assert.deepEqual(dueDates(r({ notBefore: '2026-11-10T12:00' }), '2026-11-16', '00:00'), ['2026-11-16'])
  assert.deepEqual(dueDates(r({ paused: true }), '2026-11-16', '00:00'), [])
})
function setup(repeat: Partial<Repeat> = {}) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
  h.run({ type: 'change-database', pageId: 'log', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
  h.run({ type: 'create-template', pageId: 'weekly', title: 'Weekly review', databaseId: 'log' } as never)
  const set = (over: Partial<Repeat> | null) => h.run({ type: 'change-database', pageId: 'log', change: { kind: 'setRepeat', templateId: 'weekly', repeat: over && { every: 'week', interval: 1, start: '2026-11-02', ...over } } as DatabaseChange })
  set(repeat)
  const rows = () => h.ws.pages.filter(p => p.parentId === 'log' && !p.trashedAt)
  const db = () => h.ws.pages.find(p => p.id === 'log')!.database as Database
  const tick = (today: string, time = '12:00') => h.run({ type: 'run-repeats', today, time, at })
  return { h, set, rows, db, tick }
}
test('it makes one row for a period with the template\'s title, and running again makes nothing, as a second tab would', () => {
  const s = setup()
  const a = s.tick('2026-11-02')
  assert.equal(a.receipt.message, '1 repeating row made')
  assert.deepEqual(s.rows().map(p => [p.id, p.title]), [[repeatRowId('weekly', '2026-11-02'), 'Weekly review']])
  assert.equal(s.db().repeats!.weekly!.last, '2026-11-02')
  assert.equal(s.db().repeats!.weekly!.lastRan, at)
  assert.equal(s.tick('2026-11-02').receipt.message, 'Nothing due')
  assert.equal(s.rows().length, 1)
  // A retry after losing the record of it, as after a rollback: the row's id still holds.
  s.h.ws.pages.find(p => p.id === 'log')!.database!.repeats!.weekly!.last = undefined
  s.tick('2026-11-02')
  assert.equal(s.rows().length, 1)
})
test('away for weeks: the latest only, saying how many it skipped; with the switch, every one; and neither takes the Undo in a way that matters', () => {
  const s = setup()
  const r1 = s.tick('2026-11-23')
  assert.deepEqual(s.rows().map(p => p.id), [repeatRowId('weekly', '2026-11-23')])
  assert.deepEqual(r1.receipt.skippedRepeats, [{ title: 'Weekly review', earlier: '3 earlier weeks' }])
  const all = setup({ everyMissed: true })
  const r2 = all.tick('2026-11-23')
  assert.equal(all.rows().length, 4)
  assert.equal(r2.receipt.skippedRepeats, undefined)
})
test('a row he deleted doesn\'t come back; paused, in Trash and a database in Trash make nothing; rows stay when it stops', () => {
  const s = setup()
  s.tick('2026-11-02')
  s.h.run({ type: 'delete-page', pageId: repeatRowId('weekly', '2026-11-02'), at })
  s.h.ws.pages.find(p => p.id === 'log')!.database!.repeats!.weekly!.last = undefined
  assert.equal(s.tick('2026-11-02').receipt.message, 'Nothing due')
  assert.equal(s.rows().length, 0)
  const p = setup({ paused: true })
  assert.deepEqual(dueRepeats(p.h.ws, '2026-11-23', '12:00'), [])
  const t = setup()
  t.tick('2026-11-02')
  t.h.run({ type: 'delete-template', pageId: 'weekly' })
  assert.equal(t.tick('2026-11-30').receipt.message, 'Nothing due')
  assert.equal(t.rows().length, 1)
  const d = setup()
  d.h.run({ type: 'delete-page', pageId: 'log', at })
  assert.deepEqual(dueRepeats(d.h.ws, '2026-11-30', '12:00'), [])
})
test('changing the schedule keeps what it made; turning it off clears it; bad values are refused; the schema carries it', () => {
  const s = setup()
  s.tick('2026-11-02')
  s.set({ time: '09:00', interval: 2 })
  assert.equal(s.db().repeats!.weekly!.last, '2026-11-02')
  assert.equal(s.db().repeats!.weekly!.interval, 2)
  s.set(null)
  assert.equal(s.db().repeats, undefined)
  assert.throws(() => s.set({ interval: 0 }), /how many/)
  assert.throws(() => s.set({ start: '2026-13-01' }), /start date/)
  assert.throws(() => s.set({ time: '25:00' }), /time/)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'run-repeats', today: '2026-11-04', time: '09:00', at } }).success)
  assert.ok(rowTemplates(s.h.ws, 'log').some(p => p.id === 'weekly'))
})
