// Dependencies (docs/design/sub-items.md §3, R4-5): each mode against a hand-worked table, one Undo, a row with no date, a loop refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Database, DatabaseChange, DependencyMode } from '../src/domain/database.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
// Mon 2026-03-02 is a Monday. A → B → C → D → E, each running two days, a day apart.
const chain: Array<[string, string, string]> = [['a', '2026-03-02', '2026-03-03'], ['b', '2026-03-05', '2026-03-06'], ['c', '2026-03-09', '2026-03-10'], ['d', '2026-03-12', '2026-03-13'], ['e', '2026-03-16', '2026-03-17']]
function plan(mode: DependencyMode, avoidWeekends = false) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'p', homeBlockId: null, title: 'Plan' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'p', change: c })
  change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
  change({ kind: 'setDependencies', on: { blockedBy: 'by', blocking: 'blocks', date: 'when', mode, avoidWeekends } })
  for (const [id, start, end] of chain) h.run({ type: 'add-row', databaseId: 'p', pageId: id, title: id, values: { when: { start, end } }, at })
  for (let i = 1; i < chain.length; i++) h.run({ type: 'set-values', pageId: chain[i]![0], values: { by: [chain[i - 1]![0]] }, expected: {}, at })
  const span = (id: string) => { const v = h.ws.pages.find(p => p.id === id)!.values!.when as { start: string; end: string }; return `${v.start.slice(5)}..${v.end.slice(5)}` }
  const move = (id: string, start: string, end: string) => h.run({ type: 'set-values', pageId: id, values: { when: { start, end } }, expected: {}, at })
  return { h, change, span, move, spans: () => chain.map(([id]) => span(id)) }
}
const unmoved = ['03-02..03-03', '03-05..03-06', '03-09..03-10', '03-12..03-13', '03-16..03-17']

test('turning on makes two linked relations out of sight, off leaves every row, and it needs a Date', () => {
  const s = plan('overlap')
  const db = () => s.h.ws.pages.find(p => p.id === 'p')!.database as Database
  assert.deepEqual(db().properties.filter(p => p.type === 'relation').map(p => p.name), ['Blocked by', 'Blocking'])
  assert.ok(!db().views[0]!.columns.some(c => c.id === 'by' || c.id === 'blocks'))
  assert.deepEqual(s.h.ws.pages.find(p => p.id === 'a')!.values!.blocks, ['b'])
  s.change({ kind: 'setDependencies', on: null })
  s.move('a', '2026-03-20', '2026-03-21')
  assert.equal(s.span('b'), '03-05..03-06')
  assert.ok(db().properties.some(p => p.id === 'by'))
  assert.throws(() => s.change({ kind: 'setDependencies', on: { blockedBy: 'x', blocking: 'y', date: 'by', mode: 'none' } }), /Date property/)
})
test('shift only when dates overlap: a move that still fits moves nothing, one that overlaps goes down the chain as far as it has to', () => {
  const s = plan('overlap')
  const small = s.move('a', '2026-03-02', '2026-03-04')
  assert.equal(small.receipt.shifted, undefined)
  assert.deepEqual(s.spans().slice(1), unmoved.slice(1))
  const big = s.move('a', '2026-03-02', '2026-03-10')
  // A ends the 10th, so B starts the 11th for two days; C then overlaps and starts the 13th; D starts the 15th... E starts the 17th.
  assert.deepEqual(s.spans(), ['03-02..03-10', '03-11..03-12', '03-13..03-14', '03-15..03-16', '03-17..03-18'])
  assert.deepEqual(big.receipt.shifted, ['b', 'c', 'd', 'e'])
  s.h.run({ type: 'undo', targetOperationId: big.receipt.operationId })
  assert.deepEqual(s.spans(), ['03-02..03-04', ...unmoved.slice(1)])
})
test('an earlier blocker pulls nothing back when only overlaps shift', () => {
  const s = plan('overlap')
  s.move('a', '2026-02-20', '2026-02-21')
  assert.deepEqual(s.spans().slice(1), unmoved.slice(1))
})
test('shift and keep the time between: everything moves by the same amount, back as well as on', () => {
  const s = plan('keep')
  const r = s.move('a', '2026-03-03', '2026-03-04')
  assert.deepEqual(s.spans(), ['03-03..03-04', '03-06..03-07', '03-10..03-11', '03-13..03-14', '03-17..03-18'])
  assert.equal(r.receipt.shifted!.length, 4)
  s.move('a', '2026-03-02', '2026-03-03')
  assert.deepEqual(s.spans(), unmoved)
})
test('don\'t shift moves nothing', () => {
  const s = plan('none')
  s.move('a', '2026-03-20', '2026-03-21')
  assert.deepEqual(s.spans().slice(1), unmoved.slice(1))
})
test('avoid weekends: a shifted row neither starts nor ends on a Saturday or Sunday', () => {
  const s = plan('keep', true)
  // By 2 days: B would be Sat 7th to Sun 8th, so it runs Mon 9th to Tue 10th. C would be the 11th to 12th, D Sat 14th... Mon the 16th, E the 18th.
  s.move('a', '2026-03-04', '2026-03-05')
  assert.deepEqual(s.spans(), ['03-04..03-05', '03-09..03-10', '03-11..03-12', '03-16..03-17', '03-18..03-19'])
  const o = plan('overlap', true)
  o.move('a', '2026-03-02', '2026-03-06')
  // B would start Sat the 7th: Mon the 9th to Tue the 10th. C overlaps: the 11th to the 12th. D overlaps: Fri the 13th would end on Sat, so Mon the 16th. E: the 18th.
  assert.deepEqual(o.spans(), ['03-02..03-06', '03-09..03-10', '03-11..03-12', '03-16..03-17', '03-18..03-19'])
})
test('a row with no date doesn\'t move or fail, and the chain carries on past it', () => {
  for (const mode of ['overlap', 'keep'] as const) {
    const s = plan(mode)
    s.h.run({ type: 'set-values', pageId: 'c', values: { when: null }, expected: {}, at })
    const by = mode === 'overlap' ? ['2026-03-02', '2026-03-16'] : ['2026-03-16', '2026-03-17']
    const r = s.move('a', by[0]!, by[1]!)
    assert.equal(s.h.ws.pages.find(p => p.id === 'c')!.values!.when, undefined)
    assert.ok(!r.receipt.shifted!.includes('c'))
    assert.ok(r.receipt.shifted!.includes('d'), mode)
  }
})
test('clearing a date moves nothing, and a row with several blockers waits for the last of them', () => {
  const s = plan('overlap')
  const cleared = s.h.run({ type: 'set-values', pageId: 'a', values: { when: null }, expected: {}, at })
  assert.equal(cleared.receipt.shifted, undefined)
  assert.deepEqual(chain.slice(1).map(([id]) => s.span(id)), unmoved.slice(1))
  const t = plan('overlap')
  t.h.run({ type: 'set-values', pageId: 'e', values: { by: ['d', 'a'] }, expected: {}, at })
  t.move('a', '2026-03-02', '2026-03-20')
  // A ends the 20th, which alone would put E at the 21st. But B, C and D come first, ending the 26th.
  assert.equal(t.span('e'), '03-27..03-28')
})
test('a loop is refused, either way round, and leaves the links as they were', () => {
  const s = plan('overlap')
  assert.throws(() => s.h.run({ type: 'set-values', pageId: 'a', values: { by: ['e'] }, expected: {}, at }), /loop/)
  assert.throws(() => s.h.run({ type: 'set-values', pageId: 'e', values: { blocks: ['a'] }, expected: {}, at }), /loop/)
  assert.throws(() => s.h.run({ type: 'set-values', pageId: 'a', values: { by: ['a'] }, expected: {}, at }), /loop/)
  assert.equal(s.h.ws.pages.find(p => p.id === 'a')!.values!.by, undefined)
})
test('Undo after a shift, with another tab\'s edit since, says so and overwrites nothing', () => {
  const s = plan('keep')
  const r = s.move('a', '2026-03-03', '2026-03-04')
  s.h.run({ type: 'set-values', pageId: 'c', values: { when: { start: '2026-04-01', end: '2026-04-02' } }, expected: {}, at })
  assert.throws(() => s.h.run({ type: 'undo', targetOperationId: r.receipt.operationId }), /Cannot undo/)
  assert.equal(s.span('c'), '04-01..04-02')
})
