// Databases R2: Board and Group (design §7.2, §7.3, §7.4): a view's rows in their groups, what a row stores in a group,
// the view's group fields, and a card's drop as one change with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarRows, dateProperties, groupableProperties, groupValue, movedDate, viewDateBy, newRowValues, noGroupKey, viewGroupBy, viewGroups, viewRows, type Database, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { firstImageUrl } from '../src/domain/editor-document.ts'
import type { Action, Page } from '../src/domain/types.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
const ctx = { today, pageDate: null }

/** "Reading list" with one property of each groupable type, and rows. */
function reading() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'list', homeBlockId: null, title: 'Reading list' })
  const change = (c: Extract<Action, { type: 'change-database' }>['change']) => h.run({ type: 'change-database', pageId: 'list', change: c })
  change({ kind: 'addProperty', property: { id: 'status', name: 'Status', type: 'status' } })
  change({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'novel', name: 'Novel' }, { id: 'essay', name: 'Essay' }] } })
  change({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] } })
  change({ kind: 'addProperty', property: { id: 'pages', name: 'Pages', type: 'number' } })
  change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
  change({ kind: 'addProperty', property: { id: 'owned', name: 'Owned', type: 'checkbox' } })
  change({ kind: 'addProperty', property: { id: 'link', name: 'Link', type: 'url' } })
  change({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  const add = (pageId: string, values: Record<string, unknown> = {}) => h.run({ type: 'add-row', databaseId: 'list', pageId, title: pageId, values: values as never, at })
  add('dune', { kind: 'novel', tags: ['sf'], pages: 412, due: { start: '2026-10-25' }, owned: true, link: 'b.com' })
  add('emma', { kind: 'novel', tags: ['hist', 'sf'], pages: 300, due: { start: '2026-10-20', end: '2026-10-24' }, link: 'a.com' })
  add('ubik', { kind: 'essay', pages: 300, due: { start: '2026-11-02T09:30' } })
  add('blank')
  const db = () => h.page('list').database as Database
  const rows = (v: View) => viewRows(h.ws, 'list', v, ctx)
  const order = () => h.ws.pages.filter(p => p.parentId === 'list').map(p => p.id)
  return Object.assign(h, { change, db, rows, order })
}
const view = (fields: Partial<View> = {}): View => ({ id: 'v', name: 'T', layout: 'table', columns: [], sort: [], filter: [], ...fields })
const shape = (h: ReturnType<typeof reading>, v: View) => viewGroups(h.db(), v, h.rows(v))?.shown.map(g => [g.name, g.rows.map((r: Page) => r.id)])

test('what can group: a table anything but text, a board only what a card can be dragged to', () => {
  const h = reading()
  assert.deepEqual(groupableProperties(h.db(), 'table').map(p => p.id), ['status', 'kind', 'tags', 'pages', 'due', 'owned', 'link'])
  assert.deepEqual(groupableProperties(h.db(), 'board').map(p => p.id), ['status', 'kind', 'owned'])
  assert.equal(viewGroupBy(h.db(), view({ groupBy: 'note' })), null)
  assert.equal(viewGroupBy(h.db(), view({ layout: 'board', groupBy: 'pages' })), null)
  assert.equal(viewGroupBy(h.db(), view({ groupBy: 'gone' })), null)
})

test('select: every option has a group, in option order, and no value comes last', () => {
  const h = reading()
  assert.deepEqual(shape(h, view({ groupBy: 'kind' })), [['Novel', ['dune', 'emma']], ['Essay', ['ubik']], ['No value', ['blank']]])
  h.change({ kind: 'addProperty', property: { id: 'empty', name: 'Empty', type: 'select', options: [{ id: 'x', name: 'X' }] } })
  assert.deepEqual(shape(h, view({ groupBy: 'empty' }))![0], ['X', []])
})

test('status: by To do, In progress, Done, whatever the option order, and always a value', () => {
  const h = reading()
  const status = h.db().properties.find(p => p.id === 'status')!
  h.change({ kind: 'updateProperty', propertyId: 'status', options: [...status.options!].reverse() })
  const groups = shape(h, view({ groupBy: 'status' }))!
  assert.deepEqual(groups.map(g => g[0]), ['Not started', 'In progress', 'Done'])
  assert.deepEqual(groups[0]![1], ['dune', 'emma', 'ubik', 'blank'])
})

test('checkbox: Unchecked then Checked. Multi-select: a row is in each of its groups', () => {
  const h = reading()
  assert.deepEqual(shape(h, view({ groupBy: 'owned' })), [['Unchecked', ['emma', 'ubik', 'blank']], ['Checked', ['dune']]])
  assert.deepEqual(shape(h, view({ groupBy: 'tags' })), [['SF', ['dune', 'emma']], ['History', ['emma']], ['No value', ['ubik', 'blank']]])
})

test('number, url and date have groups only where a row has the value', () => {
  const h = reading()
  assert.deepEqual(shape(h, view({ groupBy: 'pages' })), [['300', ['emma', 'ubik']], ['412', ['dune']], ['No value', ['blank']]])
  assert.deepEqual(shape(h, view({ groupBy: 'link' })), [['a.com', ['emma']], ['b.com', ['dune']], ['No value', ['ubik', 'blank']]])
  assert.deepEqual(shape(h, view({ groupBy: 'due' })), [['October 2026', ['dune', 'emma']], ['November 2026', ['ubik']], ['No value', ['blank']]])
  assert.deepEqual(shape(h, view({ groupBy: 'due', groupDateBy: 'week' })), [['Week of Oct 19, 2026', ['dune', 'emma']], ['Week of Nov 2, 2026', ['ubik']], ['No value', ['blank']]])
  assert.deepEqual(shape(h, view({ groupBy: 'due', groupDateBy: 'day' })), [['Oct 20, 2026', ['emma']], ['Oct 25, 2026', ['dune']], ['Nov 2, 2026', ['ubik']], ['No value', ['blank']]])
})

test('hidden groups are listed apart with their rows; hide empty drops the empty ones from both', () => {
  const h = reading()
  const groups = viewGroups(h.db(), view({ groupBy: 'kind', hiddenGroups: ['essay'] }), h.rows(view()))!
  assert.deepEqual(groups.shown.map(g => g.name), ['Novel', 'No value'])
  assert.deepEqual(groups.hidden.map(g => [g.name, g.rows.length]), [['Essay', 1]])
  h.change({ kind: 'addProperty', property: { id: 'sets', name: 'Sets', type: 'select', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } })
  const empty = viewGroups(h.db(), view({ groupBy: 'sets', hideEmptyGroups: true, hiddenGroups: ['a'] }), h.rows(view()))!
  assert.deepEqual(empty.shown.map(g => g.name), ['No value'])
  assert.deepEqual(empty.hidden, [])
})

test('a change on its way shows in its new group at once', () => {
  const h = reading()
  const groups = viewGroups(h.db(), view({ groupBy: 'kind' }), h.rows(view()), (row, id) => (row.id === 'dune' && id === 'kind' ? 'essay' : row.values?.[id]))!
  assert.deepEqual(groups.shown.map(g => g.rows.map(r => r.id)), [['emma'], ['dune', 'ubik'], ['blank']])
})

test('what a row stores in a group', () => {
  const h = reading()
  const p = (id: string) => h.db().properties.find(x => x.id === id)!
  assert.equal(groupValue(p('kind'), 'essay', 'novel', 'novel', today), 'essay')
  assert.equal(groupValue(p('kind'), noGroupKey, 'novel', 'novel', today), undefined)
  assert.equal(groupValue(p('owned'), 'checked', undefined, 'unchecked', today), true)
  assert.equal(groupValue(p('owned'), 'unchecked', true, 'checked', today), undefined)
  assert.equal(groupValue(p('pages'), '300', 412, '412', today), 300)
  // A multi-select swaps the group it left and keeps its others; to no value, it empties.
  assert.deepEqual(groupValue(p('tags'), 'hist', ['sf', 'x'], 'sf', today), ['hist'])
  assert.deepEqual(groupValue(p('tags'), 'sf', undefined, noGroupKey, today), ['sf'])
  assert.equal(groupValue(p('tags'), noGroupKey, ['sf', 'hist'], 'sf', today), undefined)
  // A date keeps its time and length; today if it's in the group, else the group's first day.
  assert.deepEqual(groupValue(p('due'), '2026-10', undefined, undefined, today), { start: today })
  assert.deepEqual(groupValue(p('due'), '2026-12', { start: '2026-10-20T09:30', end: '2026-10-22T10:00' }, '2026-10', today), { start: '2026-12-01T09:30', end: '2026-12-03T10:00' })
  assert.deepEqual(groupValue(p('due'), '2026-11-02', undefined, undefined, today, 'week'), { start: '2026-11-02' })
  assert.deepEqual(groupValue(p('due'), '2026-10-19', undefined, undefined, today, 'week'), { start: today })
})

test('a new row under a group starts with its value, and the filter is told when they disagree (§7.4)', () => {
  const h = reading()
  const v = view({ groupBy: 'kind' })
  assert.deepEqual(newRowValues(h.db(), v, ctx, 'essay'), { title: '', values: { kind: 'essay' }, visible: true })
  assert.deepEqual(newRowValues(h.db(), v, ctx, noGroupKey), { title: '', values: {}, visible: true })
  const filtered = view({ groupBy: 'kind', filter: [{ by: 'kind', op: 'isAnyOf', value: ['novel'] }] })
  assert.deepEqual(newRowValues(h.db(), filtered, ctx, 'novel').visible, true)
  const refused = newRowValues(h.db(), filtered, ctx, 'essay')
  assert.deepEqual([refused.values, refused.visible], [{ kind: 'essay' }, false])
  // Under a group with no value, the filter's own value would put it elsewhere: the group wins, and it's hidden.
  assert.deepEqual(newRowValues(h.db(), filtered, ctx, noGroupKey).visible, false)
})

test('the view fields: checked, stored, and kept by every other change', () => {
  const h = reading()
  const v = () => h.db().views[0]!
  h.change({ kind: 'updateView', viewId: v().id, layout: 'board', groupBy: 'kind', hiddenGroups: ['essay', 'essay'], hideEmptyGroups: true, groupDateBy: 'week' })
  assert.deepEqual([v().layout, v().groupBy, v().hiddenGroups, v().hideEmptyGroups, v().groupDateBy], ['board', 'kind', ['essay'], true, 'week'])
  h.change({ kind: 'updateView', viewId: v().id, name: 'Shelf', filter: [] })
  assert.deepEqual([v().layout, v().groupBy, v().hiddenGroups], ['board', 'kind', ['essay']])
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, groupBy: 'pages' }), /Can't group by that/)
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, groupBy: 'note' }), /Can't group by that/)
  h.change({ kind: 'updateView', viewId: v().id, layout: 'table', groupBy: 'pages', hideEmptyGroups: false, hiddenGroups: [] })
  assert.deepEqual([v().layout, v().groupBy, v().hideEmptyGroups, v().hiddenGroups], ['table', 'pages', undefined, undefined])
  h.change({ kind: 'updateView', viewId: v().id, groupBy: null })
  assert.equal(v().groupBy, undefined)
  assert.throws(() => h.change({ kind: 'addView', view: { ...view({ layout: 'nonsense' as never }), id: 'x' } }), /Unknown view type/)
  h.change({ kind: 'addView', view: view({ id: 'b', name: 'Board', layout: 'board', groupBy: 'status' }) })
  assert.equal(h.db().views[1]!.groupBy, 'status')
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: 'b', groupBy: null, hiddenGroups: [], layout: 'board', groupDateBy: 'day' } } }).success)
  assert.ok(!commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: 'b', layout: 'nonsense' } } }).success)
})

test('a deleted group property is dropped quietly and kept unread; a duplicate of that view works', () => {
  const h = reading()
  const id = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId: id, groupBy: 'kind' })
  h.change({ kind: 'removeProperty', propertyId: 'kind' })
  const v = h.db().views[0]!
  assert.equal(v.groupBy, 'kind')
  assert.equal(viewGroups(h.db(), v, h.rows(v)), null)
  // Another change to the view doesn't refuse the one it already holds.
  h.change({ kind: 'updateView', viewId: id, name: 'Still' })
  assert.equal(h.db().views[0]!.groupBy, 'kind')
  h.change({ kind: 'addView', view: { ...structuredClone(h.db().views[0]!), id: 'copy', name: 'Copy' } })
  assert.ok(h.db().views.some(x => x.id === 'copy'))
  // Type changed to one that can't group, and back: read again.
  h.change({ kind: 'updateView', viewId: id, groupBy: 'owned', layout: 'board' })
  h.change({ kind: 'updateProperty', propertyId: 'owned', type: 'text' })
  assert.equal(viewGroupBy(h.db(), h.db().views[0]!), null)
  h.change({ kind: 'updateProperty', propertyId: 'owned', type: 'checkbox' })
  assert.equal(viewGroupBy(h.db(), h.db().views[0]!)!.id, 'owned')
})

test('a card dropped in another column: value and place in one change, one Undo', () => {
  const h = reading()
  assert.deepEqual(h.order(), ['dune', 'emma', 'ubik', 'blank'])
  const r = h.run({ type: 'set-values', pageId: 'blank', values: { kind: 'novel' }, expected: { kind: null }, beforeId: 'emma', at })
  assert.equal(h.page('blank').values!.kind, 'novel')
  assert.deepEqual(h.order(), ['dune', 'blank', 'emma', 'ubik'])
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.page('blank').values?.kind, undefined)
  assert.deepEqual(h.order(), ['dune', 'emma', 'ubik', 'blank'])
  // null: the end. A row gone meanwhile: the end too. Absent: it stays where it is.
  h.run({ type: 'set-values', pageId: 'dune', values: { pages: 1 }, expected: { pages: 412 }, beforeId: null, at })
  assert.deepEqual(h.order(), ['emma', 'ubik', 'blank', 'dune'])
  h.run({ type: 'set-values', pageId: 'emma', values: { pages: 2 }, expected: { pages: 300 }, beforeId: 'gone', at })
  assert.deepEqual(h.order(), ['ubik', 'blank', 'dune', 'emma'])
  h.run({ type: 'set-values', pageId: 'ubik', values: { pages: 3 }, expected: { pages: 300 }, at })
  assert.deepEqual(h.order(), ['ubik', 'blank', 'dune', 'emma'])
  // Refused values change nothing, the place included.
  assert.throws(() => h.run({ type: 'set-values', pageId: 'ubik', values: { pages: 4 }, expected: { pages: 300 }, beforeId: null, at }), /Changed elsewhere/)
  assert.deepEqual(h.order(), ['ubik', 'blank', 'dune', 'emma'])
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'set-values', pageId: 'a', values: {}, expected: {}, beforeId: null, at } }).success)
})

test('a gallery groups as a list does', () => {
  const h = reading()
  const v = view({ layout: 'gallery', groupBy: 'kind' })
  assert.deepEqual(groupableProperties(h.db(), 'gallery'), groupableProperties(h.db(), 'table'))
  assert.equal(viewGroupBy(h.db(), v)?.id, 'kind')
  assert.deepEqual(shape(h, v), [['Novel', ['dune', 'emma']], ['Essay', ['ubik']], ['No value', ['blank']]])
})

test("a card's image: the first with a web address in the row's body", () => {
  const image = (id: string, url: string) => ({ id, type: 'image', props: { url }, children: [] })
  const doc = (...n: unknown[]) => ({ document: JSON.stringify(n) })
  assert.equal(firstImageUrl(doc()), null)
  assert.equal(firstImageUrl(doc({ id: 'p', type: 'paragraph', props: {}, content: [], children: [] })), null)
  assert.equal(firstImageUrl(doc(image('a', 'https://x.test/a.png'), image('b', 'https://x.test/b.png'))), 'https://x.test/a.png')
  assert.equal(firstImageUrl(doc(image('a', 'javascript:alert(1)'), image('b', 'data:image/png;base64,AA'), image('c', 'http://x.test/c.png'))), 'http://x.test/c.png')
  assert.equal(firstImageUrl(doc({ id: 'p', type: 'bulletListItem', props: {}, content: [], children: [image('n', 'https://x.test/nested.png')] })), 'https://x.test/nested.png')
})

test('a calendar: rows by their days, a range on each, undated ones kept, and dateBy checked', () => {
  const h = reading()
  const due = h.db().properties.find(p => p.id === 'due')!
  const v = view({ layout: 'calendar', dateBy: 'due' })
  assert.deepEqual(dateProperties(h.db()).map(p => p.id), ['due'])
  assert.equal(viewDateBy(h.db(), v)?.id, 'due')
  assert.equal(viewDateBy(h.db(), view({ layout: 'calendar', dateBy: 'pages' })), null)
  assert.equal(viewGroups(h.db(), view({ layout: 'calendar', groupBy: 'kind' }), h.rows(v)), null)
  h.run({ type: 'set-values', pageId: 'emma', values: { due: { start: '2026-10-30', end: '2026-11-02' } }, expected: { due: { start: '2026-10-20', end: '2026-10-24' } }, at })
  const { days, undated } = calendarRows(due, h.rows(v), '2026-10-25', '2026-11-01')
  assert.deepEqual(days.get('2026-10-25')?.map(r => r.id), ['dune'])
  assert.deepEqual(['2026-10-30', '2026-10-31', '2026-11-01'].map(d => days.get(d)?.map(r => r.id)), [['emma'], ['emma'], ['emma']])
  assert.equal(days.get('2026-11-02'), undefined)
  assert.deepEqual(undated.map(r => r.id), ['blank'])
  assert.equal(days.has('2026-11-02'), false)
  // No property: every row is undated, and none goes missing.
  assert.equal(calendarRows(null, h.rows(v), '2026-10-25', '2026-11-01').undated.length, 4)
  const id = h.db().views[0]!.id
  assert.throws(() => h.change({ kind: 'updateView', viewId: id, dateBy: 'pages' }), /Can't place rows by that/)
  h.change({ kind: 'updateView', viewId: id, layout: 'calendar', dateBy: 'due' })
  assert.equal(h.db().views[0]!.dateBy, 'due')
  h.change({ kind: 'removeProperty', propertyId: 'due' })
  h.change({ kind: 'updateView', viewId: id, name: 'Still' })
  assert.equal(h.db().views[0]!.dateBy, 'due')
  assert.equal(viewDateBy(h.db(), h.db().views[0]!), null)
})

test('moving a row to another day keeps its time and length, from the day he took it', () => {
  const p = { id: 'd', name: 'D', type: 'date' } as const
  assert.deepEqual(movedDate(p, undefined, null, '2026-11-05'), { start: '2026-11-05' })
  assert.deepEqual(movedDate(p, { start: '2026-11-02' }, '2026-11-02', '2026-11-05'), { start: '2026-11-05' })
  assert.deepEqual(movedDate(p, { start: '2026-11-02T09:30' }, '2026-11-02', '2026-11-05'), { start: '2026-11-05T09:30' })
  // Taken from the second day of a range, dropped a day later: the whole range moves one day.
  assert.deepEqual(movedDate(p, { start: '2026-11-02', end: '2026-11-04' }, '2026-11-03', '2026-11-04'), { start: '2026-11-03', end: '2026-11-05' })
  assert.deepEqual(movedDate(p, { start: '2026-10-31' }, '2026-10-31', '2026-11-01'), { start: '2026-11-01' })
})
