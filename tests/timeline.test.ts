// Timeline (docs/design/timeline.md): what each row draws, what a drag writes, and the phone's list by week.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Database, Property, View } from '../src/domain/database.ts'
import { draggedBar, endAt, shifted, startAt, timelineBars, timelineWeeks, type TimelineBar } from '../src/domain/timeline.ts'
import type { Page } from '../src/domain/types.ts'

const properties: Property[] = [{ id: 'when', name: 'When', type: 'date' }, { id: 'from', name: 'From', type: 'date' }, { id: 'to', name: 'To', type: 'date' }, { id: 'made', name: 'Made', type: 'createdTime' }]
const db = { homeBlockId: null, properties, views: [] } as Database
const view = (fields: Partial<View> = {}): View => ({ id: 'v', name: 'T', layout: 'timeline', columns: [], sort: [], filter: [], dateBy: 'when', ...fields })
const row = (id: string, values: Record<string, unknown>): Page => ({ id, type: 'document', date: null, title: id, document: '[]', values, createdAt: '2026-11-01T10:00:00Z' } as unknown as Page)
const one = (bars: TimelineBar[]) => bars[0]!
const raw = (r: Page) => (p: Property) => (r.values?.[p.id] ?? null) as { start: string; end?: string } | null
const pair = view({ dateBy: 'from', timelineEnd: 'to' })
const of = (r: Page, v = pair) => one(timelineBars(db, v, [r]).bars)

test('§3: each row draws what it has, and no row goes missing', () => {
  const rows = [row('single', { when: { start: '2026-11-05' } }), row('range', { when: { start: '2026-11-05', end: '2026-11-09' } }), row('none', {})]
  const { bars, undated } = timelineBars(db, view(), rows)
  assert.deepEqual(bars.map(b => [b.row.id, b.shape, b.start, b.end]), [['single', 'day', '2026-11-05', '2026-11-05'], ['range', 'range', '2026-11-05', '2026-11-09']])
  assert.deepEqual(undated.map(r => r.id), ['none'])
  assert.equal(bars.length + undated.length, rows.length)
  assert.equal(of(row('s', { from: { start: '2026-11-05' } })).shape, 'open-end')
  assert.equal(of(row('e', { to: { start: '2026-11-05' } })).shape, 'open-start')
  const backwards = of(row('b', { from: { start: '2026-11-09' }, to: { start: '2026-11-05' } }))
  assert.deepEqual([backwards.shape, backwards.start, backwards.end], ['inverted', '2026-11-09', '2026-11-09'], 'one day on Start')
  assert.equal(timelineBars(db, pair, [row('n', {})]).undated.length, 1)
  const made = of(row('m', {}), view({ dateBy: 'made' }))
  assert.equal(made.readOnly, true)
  assert.equal(made.shape, 'day')
})

test('a move keeps its length; an edge changes one end, and never crosses the other', () => {
  const r = row('r', { when: { start: '2026-11-05', end: '2026-11-09' } }), bar = of(r, view())
  assert.deepEqual(draggedBar(bar, 'move', 2 * 1440, raw(r)).writes, [{ id: 'when', value: { start: '2026-11-07', end: '2026-11-11' } }])
  assert.deepEqual(draggedBar(bar, 'start', -1440, raw(r)).writes, [{ id: 'when', value: { start: '2026-11-04', end: '2026-11-09' } }])
  assert.deepEqual(draggedBar(bar, 'end', 1440, raw(r)).writes, [{ id: 'when', value: { start: '2026-11-05', end: '2026-11-10' } }])
  assert.deepEqual(draggedBar(bar, 'end', -10 * 1440, raw(r)).writes, [{ id: 'when', value: { start: '2026-11-05' } }], 'the end stops at the start, and is then one day')
  assert.deepEqual(draggedBar(bar, 'start', 10 * 1440, raw(r)).writes, [{ id: 'when', value: { start: '2026-11-09' } }])
  const single = row('s', { when: { start: '2026-11-05' } })
  assert.deepEqual(draggedBar(of(single, view()), 'move', 1440, raw(single)).writes, [{ id: 'when', value: { start: '2026-11-06' } }], 'keeps one day')
  assert.deepEqual(draggedBar(of(single, view()), 'end', 2 * 1440, raw(single)).writes, [{ id: 'when', value: { start: '2026-11-05', end: '2026-11-07' } }], 'an edge makes it a range')
})

test('a move keeps a time, and only at Hours does it move by hours', () => {
  assert.equal(shifted('2026-11-05T09:30', 1440), '2026-11-06T09:30')
  assert.equal(shifted('2026-11-05T23:30', 60), '2026-11-06T00:30')
  assert.equal(shifted('2026-11-05', 60), '2026-11-05', 'a date with no time moves only by whole days')
  assert.equal(startAt('2026-11-05T12:00', '2026-11-05', 'hours'), 0.5)
  assert.equal(startAt('2026-11-05T12:00', '2026-11-05', 'day'), 0)
  assert.equal(endAt('2026-11-05', '2026-11-05', 'day', '2026-11-05'), 1)
})

test('§3: on a pair, only what the drag asks for changes', () => {
  const both = row('b', { from: { start: '2026-11-05' }, to: { start: '2026-11-09' } })
  assert.deepEqual(draggedBar(of(both), 'move', 1440, raw(both)).writes.map(w => [w.id, w.value]), [['from', { start: '2026-11-06' }], ['to', { start: '2026-11-10' }]])
  assert.deepEqual(draggedBar(of(both), 'end', 1440, raw(both)).writes.map(w => w.id), ['to'])
  const start = row('s', { from: { start: '2026-11-05' } })
  assert.deepEqual(draggedBar(of(start), 'move', 1440, raw(start)).writes.map(w => [w.id, w.value]), [['from', { start: '2026-11-06' }]], 'sets Start')
  assert.deepEqual(draggedBar(of(start), 'end', 2 * 1440, raw(start)).writes.map(w => [w.id, w.value]), [['to', { start: '2026-11-07' }]], 'the right edge sets End')
  const end = row('e', { to: { start: '2026-11-09' } })
  assert.deepEqual(draggedBar(of(end), 'move', 1440, raw(end)).writes.map(w => [w.id, w.value]), [['to', { start: '2026-11-10' }]], 'sets End')
  assert.deepEqual(draggedBar(of(end), 'start', -2 * 1440, raw(end)).writes.map(w => [w.id, w.value]), [['from', { start: '2026-11-07' }]], 'the left edge sets Start')
  const backwards = row('i', { from: { start: '2026-11-09' }, to: { start: '2026-11-05' } })
  const moved = draggedBar(of(backwards), 'move', 1440, raw(backwards))
  assert.deepEqual(moved.writes.map(w => [w.id, w.value]), [['from', { start: '2026-11-10' }], ['to', { start: '2026-11-10' }]], 'moving sets both, which clears it')
  assert.deepEqual(draggedBar(of(backwards), 'move', 0, raw(backwards)).start, '2026-11-09')
})

test('§4: a list by week: over is earlier, and a row still running stays in this week', () => {
  const bars = timelineBars(db, view(), [
    row('over', { when: { start: '2026-10-20', end: '2026-10-22' } }),
    row('running', { when: { start: '2026-10-28', end: '2026-11-06' } }),
    row('now', { when: { start: '2026-11-03' } }),
    row('next', { when: { start: '2026-11-10' } }),
  ]).bars
  const { weeks, earlier } = timelineWeeks(bars, '2026-11-04', 0)
  assert.deepEqual(weeks.map(w => [w.week, w.bars.map(b => b.row.id)]), [['2026-11-01', ['running', 'now']], ['2026-11-08', ['next']]])
  assert.deepEqual(earlier.map(w => [w.week, w.bars.map(b => b.row.id)]), [['2026-10-18', ['over']]])
  assert.equal(timelineWeeks(bars, '2026-11-04', 1).weeks[0]!.week, '2026-11-02', 'follows Week starts')
  assert.equal(timelineWeeks(bars.slice(0, 1), '2026-11-04').weeks.length, 0, 'all in the past: the caller opens Earlier')
})
