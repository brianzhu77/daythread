// Databases R2: Board and Group (design §7.2, §7.3, §7.4): a view's rows in their groups, what a row stores in a group,
// the view's group fields, and a card's drop as one change with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { databaseRows, calcChoices, calendarRows, cellValue, columnCalc, conditionHolds, inView, lostOnTypeChange, dateProperties, groupableProperties, groupValue, movedDate, startOfWeek, viewDateBy, newRowValues, noGroupKey, valueText, viewGroupBy, viewCalculations, viewGroups, viewRows, type CalcKind, type Database, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { firstImageUrl } from '../src/domain/editor-document.ts'
import type { Action, Page } from '../src/domain/types.ts'
import { harness, today } from './v2-helpers.ts'
import { defaultRowTemplate, newPageTemplate, rowTemplates, templates } from '../src/domain/day-template.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import { calcText, emailHref, phoneHref } from '../src/components/property-values.ts'

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
  assert.deepEqual(shape(h, view({ groupBy: 'due', groupDateBy: 'week' })), [['Week of Oct 18, 2026', ['emma']], ['Week of Oct 25, 2026', ['dune']], ['Week of Nov 1, 2026', ['ubik']], ['No value', ['blank']]])
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
  assert.deepEqual(groupValue(p('due'), '2026-11-01', undefined, undefined, today, 'week'), { start: '2026-11-01' })
  assert.deepEqual(groupValue(p('due'), '2026-10-18', undefined, undefined, today, 'week'), { start: today })
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

test('one week rule: Sunday by default, and Monday moves all of it together (R3-20)', () => {
  // Nov 1, 2026 is a Sunday; Nov 2 a Monday.
  assert.equal(startOfWeek('2026-11-01'), '2026-11-01')
  assert.equal(startOfWeek('2026-11-07'), '2026-11-01')
  assert.equal(startOfWeek('2026-11-01', 1), '2026-10-26')
  assert.equal(startOfWeek('2026-11-02', 1), '2026-11-02')
  const h = reading()
  const due = h.db().properties.find(p => p.id === 'due')!
  const thisWeek = { by: 'due', op: 'within', value: 'thisWeek' } as const
  const on = (day: string, weekStart?: 0 | 1) => conditionHolds(due, thisWeek, { start: day }, { today: '2026-11-01', pageDate: null, weekStart })
  assert.equal(on('2026-11-07'), true)
  assert.equal(on('2026-10-31'), false)
  assert.equal(on('2026-10-31', 1), true)
  assert.equal(on('2026-11-02', 1), false)
  const v = view({ groupBy: 'due', groupDateBy: 'week' })
  const names = (w?: 0 | 1) => viewGroups(h.db(), v, h.rows(v), undefined, w)!.shown.map(g => g.name)
  assert.equal(names()[0], 'Week of Oct 18, 2026')
  assert.equal(names(1)[0], 'Week of Oct 19, 2026')
  assert.deepEqual(groupValue(due, '2026-11-02', undefined, undefined, today, 'week', 1), { start: '2026-11-02' })
})

test('the week setting is stored, sent with changes, and undone', () => {
  const h = reading()
  assert.equal(h.ws.weekStart, undefined)
  const r = h.run({ type: 'set-week-start', weekStart: 1 })
  assert.equal(h.ws.weekStart, 1)
  assert.equal(r.receipt.message, 'Weeks start on Monday')
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'set-week-start', weekStart: 1 } }).success)
  assert.ok(!commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'set-week-start', weekStart: 3 } }).success)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.ws.weekStart, undefined)
  h.run({ type: 'set-week-start', weekStart: 1 })
  h.run({ type: 'set-week-start', weekStart: 0 })
  assert.equal(h.ws.weekStart, undefined)
})

test('a calendar by week is stored on the view, and back to a month clears it', () => {
  const h = reading()
  const id = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId: id, layout: 'calendar', dateBy: 'due', calendarSpan: 'week' })
  assert.equal(h.db().views[0]!.calendarSpan, 'week')
  h.change({ kind: 'updateView', viewId: id, name: 'Still' })
  assert.equal(h.db().views[0]!.calendarSpan, 'week')
  h.change({ kind: 'updateView', viewId: id, calendarSpan: null })
  assert.equal(h.db().views[0]!.calendarSpan, undefined)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: id, calendarSpan: null } } }).success)
})

test('any rule matches: a row in if one holds, and rules that cannot be read do not count (R3-4)', () => {
  const h = reading()
  const novels = { by: 'kind', op: 'isAnyOf', value: ['novel'] } as const
  const long = { by: 'pages', op: 'gt', value: 350 } as const
  const titles = (v: View) => h.rows(v).map(r => r.id)
  assert.deepEqual(titles(view({ filter: [novels, long] })), ['dune'])
  assert.deepEqual(titles(view({ filter: [{ by: 'kind', op: 'isAnyOf', value: ['essay'] }, long], filterAny: true })), ['dune', 'ubik'])
  // A deleted property's rule, or one with no value yet, doesn't count: it neither lets everything in nor hides everything.
  const gone = { by: 'gone', op: 'isEmpty' } as const, unfinished = { by: 'note', op: 'contains' } as const
  assert.deepEqual(titles(view({ filter: [gone, long], filterAny: true })), ['dune'])
  assert.deepEqual(titles(view({ filter: [unfinished, long], filterAny: true })), ['dune'])
  assert.equal(titles(view({ filter: [gone, unfinished], filterAny: true })).length, 4)
  assert.equal(inView(h.db(), h.page('blank'), view({ filter: [novels], filterAny: true }), ctx), false)
})

test('a new row under any rule takes one value that shows it, or none and the notice (R3-4, §7.4)', () => {
  const h = reading()
  const novels = { by: 'kind', op: 'isAnyOf', value: ['novel'] } as const, sf = { by: 'tags', op: 'contains', value: ['sf'] } as const
  assert.deepEqual(newRowValues(h.db(), view({ filter: [novels, sf], filterAny: true }), ctx), { title: '', values: { kind: 'novel' }, visible: true })
  // All rules: every value it can take.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [novels, sf] }), ctx).values, { kind: 'novel', tags: ['sf'] })
  // The first gives no single value; the second does.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [{ by: 'pages', op: 'gt', value: 1 }, novels], filterAny: true }), ctx).values, { kind: 'novel' })
  // No rule gives one: no values, and it's hidden.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [{ by: 'pages', op: 'gt', value: 1 }, { by: 'note', op: 'contains', value: 'x' }], filterAny: true }), ctx), { title: '', values: {}, visible: false })
  // Already shown with nothing set: nothing's added.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [{ by: 'kind', op: 'isEmpty' }, novels], filterAny: true }), ctx), { title: '', values: {}, visible: true })
})

test('any is stored on the view, kept by other changes, and off again', () => {
  const h = reading()
  const id = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId: id, filterAny: true, filter: [{ by: 'kind', op: 'isEmpty' }] })
  assert.equal(h.db().views[0]!.filterAny, true)
  h.change({ kind: 'updateView', viewId: id, name: 'Still' })
  assert.equal(h.db().views[0]!.filterAny, true)
  h.change({ kind: 'updateView', viewId: id, filterAny: false })
  assert.equal(h.db().views[0]!.filterAny, undefined)
  h.change({ kind: 'addView', view: view({ id: 'c', filterAny: true }) })
  assert.equal(h.db().views.at(-1)!.filterAny, true)
})


// ---------- R3-9, R3-10: Created time, Edited time, ID, Email, Phone

/** Three rows, and each of the new types as a property. */
function typed() {
  const h = reading()
  h.change({ kind: 'addProperty', property: { id: 'mail', name: 'Mail', type: 'email' } })
  h.change({ kind: 'addProperty', property: { id: 'tel', name: 'Tel', type: 'phone' } })
  h.change({ kind: 'addProperty', property: { id: 'made', name: 'Made', type: 'createdTime' } })
  h.change({ kind: 'addProperty', property: { id: 'seen', name: 'Seen', type: 'editedTime' } })
  return h
}
const number = (h: ReturnType<typeof reading>, id: string) => cellValue(h.db(), h.page(id), 'num')
const undoLast = (h: ReturnType<typeof reading>) => h.run({ type: 'undo', targetOperationId: h.ws.undo!.operationId })

test('ID: rows are numbered in page order when the first ID property is made, and new rows go on from there', () => {
  const h = typed()
  assert.equal(h.db().nextRowNumber, undefined)
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  assert.deepEqual(h.order().map(id => number(h, id)), [1, 2, 3, 4])
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'new', title: 'New', at })
  assert.equal(number(h, 'new'), 5)
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'twin', title: 'Twin', copyOf: 'dune', at } as never)
  assert.equal(number(h, 'twin'), 6, 'a duplicate has its own')
})
test('ID: a number is never used twice, after a trashed row or an undone add', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'new', title: 'New', at })
  assert.equal(number(h, 'new'), 5)
  undoLast(h)
  assert.equal(h.ws.pages.some(p => p.id === 'new'), false)
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'next', title: 'Next', at })
  assert.equal(number(h, 'next'), 6)
})
test('ID: undoing the property leaves no number to reuse, and a second ID property reads the same numbers', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  undoLast(h)
  assert.equal(h.db().nextRowNumber, 5)
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  assert.deepEqual(h.order().map(id => number(h, id)), [5, 6, 7, 8])
  h.change({ kind: 'addProperty', property: { id: 'num2', name: 'Again', type: 'id' } })
  assert.deepEqual(h.order().map(id => cellValue(h.db(), h.page(id), 'num2')), [5, 6, 7, 8])
})
test('ID: a type change makes numbers too, and leaves the old values where they were', () => {
  const h = typed()
  h.change({ kind: 'updateProperty', propertyId: 'note', type: 'id' })
  assert.equal(cellValue(h.db(), h.page('dune'), 'note'), 1)
  assert.equal(h.db().nextRowNumber, 5)
})
test('the app-filled types refuse any value, a value for the row number included', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  for (const key of ['made', 'seen', 'num', '@id']) {
    const before = JSON.stringify(h.page('dune').values)
    assert.throws(() => h.run({ type: 'set-values', pageId: 'dune', values: { [key]: 9 } } as never), `${key} refused`)
    assert.equal(JSON.stringify(h.page('dune').values), before)
  }
})
test('Created time reads the row, in local time, and a row from before stays empty', () => {
  const h = typed()
  const made = cellValue(h.db(), h.page('dune'), 'made') as { start: string }
  const d = new Date(at), two = (n: number) => String(n).padStart(2, '0')
  assert.equal(made.start, `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`)
  delete h.page('dune').createdAt
  delete h.page('dune').editedAt
  assert.equal(cellValue(h.db(), h.page('dune'), 'made'), null)
  assert.equal(cellValue(h.db(), h.page('dune'), 'seen'), null)
})
test('Edited time moves on a value, a rename and a changed body, and not on a save with nothing new', () => {
  const h = typed()
  const edited = () => h.page('dune').editedAt
  const stale = '2020-01-01T00:00:00.000Z'
  h.page('dune').editedAt = stale
  const same = h.page('dune').document
  h.run({ type: 'save-editor', pageId: 'dune', expectedContent: pageContentKey(h.page('dune')), document: same } as never)
  assert.equal(edited(), stale, 'nothing new')
  h.run({ type: 'rename-page', pageId: 'dune', title: 'Dune 2' })
  assert.notEqual(edited(), stale, 'rename')
  h.page('dune').editedAt = stale
  h.run({ type: 'save-editor', pageId: 'dune', expectedContent: pageContentKey(h.page('dune')), document: JSON.stringify([{ id: 'x', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Hi', styles: {} }], children: [] }]) } as never)
  assert.notEqual(edited(), stale, 'body')
  h.page('dune').editedAt = stale
  h.run({ type: 'set-values', pageId: 'dune', values: { pages: 1 } } as never)
  assert.notEqual(edited(), stale, 'value')
})
test('filter and sort: Email and Phone as text, ID as a number, the times as dates', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  h.run({ type: 'set-values', pageId: 'dune', values: { mail: 'a@b.co', tel: 'not a number' } } as never)
  const shown = (fields: Partial<View>) => h.rows(view(fields)).map(r => r.id)
  assert.deepEqual(shown({ filter: [{ by: 'mail', op: 'contains', value: 'B.CO' }] }), ['dune'])
  assert.deepEqual(shown({ filter: [{ by: 'tel', op: 'isNotEmpty' }] }), ['dune'])
  assert.deepEqual(shown({ filter: [{ by: 'num', op: 'gt', value: 3 }] }), ['blank'])
  assert.deepEqual(shown({ sort: [{ by: 'num', direction: 'desc' }] }), ['blank', 'ubik', 'emma', 'dune'])
  const day = (cellValue(h.db(), h.page('dune'), 'made') as { start: string }).start.slice(0, 10)
  assert.equal(shown({ filter: [{ by: 'made', op: 'is', value: { date: day } }] }).length, 4)
  assert.equal(shown({ filter: [{ by: 'made', op: 'before', value: { date: day } }] }).length, 0)
})
test('grouping: by a time as dates, with + New setting nothing and shown; by Email by its words; never by ID', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  assert.equal(groupableProperties(h.db(), 'table').some(p => p.id === 'num'), false)
  assert.equal(groupableProperties(h.db(), 'board').some(p => p.id === 'made' || p.id === 'mail'), false)
  const v = view({ groupBy: 'made', groupDateBy: 'month' })
  const groups = viewGroups(h.db(), v, h.rows(v))!.shown
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.rows.length, 4)
  const made = newRowValues(h.db(), v, ctx, groups[0]!.key)
  assert.deepEqual(made.values, {})
  h.run({ type: 'set-values', pageId: 'dune', values: { mail: 'a@b.co' } } as never)
  const byMail = view({ groupBy: 'mail' })
  assert.deepEqual(shape(h, byMail)?.find(g => g[0] === 'a@b.co')?.[1], ['dune'])
  assert.deepEqual(newRowValues(h.db(), byMail, ctx, 'a@b.co').values, { mail: 'a@b.co' })
})
test('+ New under a rule on a filled-in type: no value to set, and shown when its own time or number fits', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  const local = new Date(), two = (n: number) => String(n).padStart(2, '0')
  const now = `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())}`
  const on = newRowValues(h.db(), view({ filter: [{ by: 'made', op: 'is', value: { date: now } }] }), ctx)
  assert.deepEqual([on.values, on.visible], [{}, true])
  const off = newRowValues(h.db(), view({ filter: [{ by: 'num', op: 'lt', value: 2 }] }), ctx)
  assert.deepEqual([off.values, off.visible], [{}, false])
  const next = newRowValues(h.db(), view({ filter: [{ by: 'num', op: 'eq', value: 5 }] }), ctx)
  assert.deepEqual([next.values, next.visible], [{}, true])
})
test('what links: an address and a number; anything else is just text and is kept', () => {
  assert.equal(emailHref(' a.b@c.co '), 'mailto:a.b@c.co')
  for (const no of ['', 'a@b', 'a b@c.co', 'call me']) assert.equal(emailHref(no), null)
  assert.equal(phoneHref('+1 (415) 555-0100'), 'tel:+14155550100')
  for (const no of ['', '12', 'call me', '415-CALL-NOW']) assert.equal(phoneHref(no), null)
  const h = typed()
  h.run({ type: 'set-values', pageId: 'dune', values: { mail: 'not an address', tel: 'ask at the desk' } } as never)
  assert.equal(cellValue(h.db(), h.page('dune'), 'mail'), 'not an address')
  assert.equal(cellValue(h.db(), h.page('dune'), 'tel'), 'ask at the desk')
})
test('changing to a filled-in type counts what it hides; changing back gives it back', () => {
  const h = typed()
  h.run({ type: 'set-values', pageId: 'dune', values: { note: 'keep' } } as never)
  const note = h.db().properties.find(p => p.id === 'note')!
  assert.equal(lostOnTypeChange(h.ws, 'list', note, 'createdTime'), 1)
  assert.equal(lostOnTypeChange(h.ws, 'list', note, 'email'), 0)
  h.change({ kind: 'updateProperty', propertyId: 'note', type: 'createdTime' })
  h.change({ kind: 'updateProperty', propertyId: 'note', type: 'text' })
  assert.equal(cellValue(h.db(), h.page('dune'), 'note'), 'keep')
})

// ---------- R3-21: calendar by a created or edited time; R3-9: an ID's prefix

test('a calendar can sit by a created or edited time', () => {
  const h = typed()
  assert.deepEqual(dateProperties(h.db()).map(p => p.id), ['due', 'made', 'seen'])
  const viewId = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId, layout: 'calendar', dateBy: 'made' })
  assert.equal(viewDateBy(h.db(), h.db().views[0]!)?.id, 'made')
  h.change({ kind: 'updateProperty', propertyId: 'made', type: 'text' })
  assert.equal(viewDateBy(h.db(), h.db().views[0]!), null, 'not a date any more')
})
test('by a created time: rows on their day, and a row from before them still in reach', () => {
  const h = typed()
  const made = h.db().properties.find(p => p.id === 'made')!
  const day = (cellValue(h.db(), h.page('dune'), 'made') as { start: string }).start.slice(0, 10)
  delete h.page('blank').createdAt
  delete h.page('blank').editedAt
  const { days, undated } = calendarRows(made, h.rows(view()), day, day)
  assert.deepEqual(days.get(day)?.map(r => r.id), ['dune', 'emma', 'ubik'])
  assert.deepEqual(undated.map(r => r.id), ['blank'])
  const by = calendarRows(h.db().properties.find(p => p.id === 'due')!, h.rows(view()), '2026-10-01', '2026-11-30')
  assert.deepEqual(by.undated.map(r => r.id), ['blank'], 'a Date property still has its line')
})
test('an ID prefix shows and copies, and changes no number', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  const stored = () => h.order().map(id => h.page(id).values?.['@id'])
  const before = stored(), next = h.db().nextRowNumber
  h.change({ kind: 'updateProperty', propertyId: 'num', prefix: ' BK- ' })
  const num = () => h.db().properties.find(p => p.id === 'num')!
  assert.equal(num().prefix, 'BK-')
  assert.deepEqual(stored(), before)
  assert.equal(h.db().nextRowNumber, next)
  assert.equal(cellValue(h.db(), h.page('dune'), 'num'), 1, 'filter and sort read the number')
  assert.equal(valueText(h.db(), 'num', 1), 'BK-1')
  assert.deepEqual(h.rows(view({ filter: [{ by: 'num', op: 'gt', value: 3 }] })).map(r => r.id), ['blank'])
  h.change({ kind: 'updateProperty', propertyId: 'num', prefix: '' })
  assert.equal('prefix' in num(), false, 'cleared')
  assert.equal(valueText(h.db(), 'num', 1), '1')
  assert.throws(() => h.change({ kind: 'updateProperty', propertyId: 'num', prefix: 'x'.repeat(21) }))
  h.change({ kind: 'updateProperty', propertyId: 'num', prefix: 'A-' })
  h.change({ kind: 'updateProperty', propertyId: 'num', name: 'Number' })
  assert.equal(num().prefix, 'A-', 'a rename keeps it')
})

// ---------- R3-8: column calculations

const calc = (h: ReturnType<typeof reading>, id: string, kind: CalcKind, rows = h.rows(view())) => columnCalc(h.db(), rows, id, kind)
test('calculations: what each type offers', () => {
  assert.ok(calcChoices('number').includes('sum') && !calcChoices('text').includes('sum'))
  assert.ok(calcChoices('date').includes('dateRange') && !calcChoices('number').includes('dateRange'))
  assert.deepEqual(calcChoices('checkbox'), ['countAll', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked'])
  assert.ok(calcChoices('status').includes('percentPerGroup') && !calcChoices('select').includes('percentPerGroup'))
  assert.ok(calcChoices('createdTime').includes('earliest') && calcChoices('editedTime').includes('dateRange'))
  assert.ok(calcChoices('id').includes('max') && !calcChoices('id').includes('sum'))
  assert.ok(calcChoices('email').includes('countUnique') && !calcChoices('phone').includes('sum'))
})
test('calculations: counts, over a multi-select too', () => {
  const h = reading()
  assert.deepEqual(calc(h, 'title', 'countAll'), { type: 'count', value: 4 })
  assert.deepEqual(calc(h, 'tags', 'countValues'), { type: 'count', value: 3 }, 'each value of each row')
  assert.deepEqual(calc(h, 'tags', 'countUnique'), { type: 'count', value: 2 })
  assert.deepEqual(calc(h, 'tags', 'countNotEmpty'), { type: 'count', value: 2 })
  assert.deepEqual(calc(h, 'tags', 'countEmpty'), { type: 'count', value: 2 })
  assert.deepEqual(calc(h, 'kind', 'percentNotEmpty'), { type: 'percent', value: 75 })
  assert.deepEqual(calc(h, 'kind', 'percentEmpty'), { type: 'percent', value: 25 })
  assert.deepEqual(calc(h, 'pages', 'countUnique'), { type: 'count', value: 2 })
})
test('calculations: numbers skip the empty ones, and none has no average', () => {
  const h = reading()
  assert.equal(calc(h, 'pages', 'sum').value, 1012)
  assert.equal(calc(h, 'pages', 'average').value, 337.3333333333)
  assert.equal(calc(h, 'pages', 'median').value, 300)
  assert.equal(calc(h, 'pages', 'min').value, 300)
  assert.equal(calc(h, 'pages', 'max').value, 412)
  assert.equal(calc(h, 'pages', 'range').value, 112)
  const none = h.rows(view()).filter(r => r.id === 'blank')
  assert.equal(calc(h, 'pages', 'sum', none).value, 0)
  for (const kind of ['average', 'median', 'min', 'max', 'range'] as const) assert.equal(calc(h, 'pages', kind, none).value, null, kind)
  assert.equal(calc(h, 'pages', 'percentEmpty', []).value, null, 'no rows, no percent')
  assert.equal(calc(h, 'pages', 'median', h.rows(view()).filter(r => r.id !== 'emma')).value, 356, 'an even count takes the middle two')
})
test('calculations: dates reach to a range\'s end; checkboxes count', () => {
  const h = reading()
  assert.equal(calc(h, 'due', 'earliest').value, '2026-10-20')
  assert.equal(calc(h, 'due', 'latest').value, '2026-11-02T09:30')
  assert.equal(calc(h, 'due', 'dateRange').value, 13)
  assert.equal(calc(h, 'due', 'latest', h.rows(view()).filter(r => r.id === 'emma')).value, '2026-10-24')
  assert.equal(calc(h, 'due', 'dateRange', h.rows(view()).filter(r => r.id === 'blank')).value, null)
  assert.deepEqual([calc(h, 'owned', 'checked').value, calc(h, 'owned', 'unchecked').value, calc(h, 'owned', 'percentChecked').value, calc(h, 'owned', 'percentUnchecked').value], [1, 3, 25, 75])
})
test('calculations: a status per group', () => {
  const h = reading()
  const options = h.db().properties.find(p => p.id === 'status')!.options!
  h.run({ type: 'set-values', pageId: 'dune', values: { status: options.find(o => o.group === 'done')!.id } } as never)
  h.run({ type: 'set-values', pageId: 'emma', values: { status: options.find(o => o.group === 'active')!.id } } as never)
  h.run({ type: 'set-values', pageId: 'ubik', values: { status: options.find(o => o.group === 'todo')!.id } } as never)
  const counts = calc(h, 'status', 'countPerGroup')
  assert.deepEqual(counts.type === 'groups' && counts.value.map(g => [g.group, g.count]), [['todo', 2], ['active', 1], ['done', 1]], 'a Status always has a value')
  const percents = calc(h, 'status', 'percentPerGroup')
  assert.deepEqual(percents.type === 'groups' && [percents.percent, percents.value.map(g => g.count)], [true, [50, 25, 25]])
})
test('calculations: read-only columns count like the rest', () => {
  const h = typed()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  assert.equal(calc(h, 'num', 'max').value, 4)
  assert.equal(calc(h, 'num', 'min').value, 1)
  assert.equal(calc(h, 'num', 'countUnique').value, 4)
  assert.deepEqual(calc(h, 'made', 'dateRange'), { type: 'days', value: 0 })
  assert.equal(calc(h, 'seen', 'countNotEmpty').value, 4)
})
test('calculations agree with the filter, and a group has its own', () => {
  const h = reading()
  const filtered = view({ filter: [{ by: 'kind', op: 'isAnyOf', value: ['novel'] }] })
  assert.equal(calc(h, 'pages', 'sum', h.rows(filtered)).value, 712)
  const grouped = view({ groupBy: 'kind' })
  const groups = viewGroups(h.db(), grouped, h.rows(grouped))!.shown
  assert.deepEqual(groups.map(g => [g.name, calc(h, 'pages', 'sum', g.rows).value]), [['Novel', 712], ['Essay', 300], ['No value', 0]])
})
test('a cell still saving counts as it shows', () => {
  const h = reading()
  const out = columnCalc(h.db(), h.rows(view()), 'pages', 'sum', (row, id) => row.id === 'dune' ? 1000 : cellValue(h.db(), row, id))
  assert.equal(out.value, 1600)
})
test('a view keeps its calculations, with one Undo, and they stop drawing when they no longer fit', () => {
  const h = reading()
  const viewId = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId, calculations: { pages: 'sum', title: 'countAll' } })
  assert.deepEqual(h.db().views[0]!.calculations, { pages: 'sum', title: 'countAll' })
  assert.deepEqual(viewCalculations(h.db(), h.db().views[0]!), { pages: 'sum', title: 'countAll' })
  h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'text' })
  assert.deepEqual(viewCalculations(h.db(), h.db().views[0]!), { title: 'countAll' }, 'Sum on text draws nothing')
  h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'number' })
  assert.deepEqual(viewCalculations(h.db(), h.db().views[0]!), { pages: 'sum', title: 'countAll' }, 'and is back with the type')
  h.change({ kind: 'removeProperty', propertyId: 'pages' })
  assert.deepEqual(viewCalculations(h.db(), h.db().views[0]!), { title: 'countAll' })
  h.change({ kind: 'updateView', viewId, calculations: {} })
  assert.equal('calculations' in h.db().views[0]!, false, 'none left: no field')
  assert.throws(() => h.change({ kind: 'updateView', viewId, calculations: { title: 'nonsense' } } as never))
  assert.equal(commandSchema.safeParse({ operationId: 'x', expectedRevision: 0, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId, calculations: { title: 'nonsense' } } } }).success, false)
  // A rename keeps them.
  h.change({ kind: 'updateView', viewId, calculations: { title: 'countAll' } })
  h.change({ kind: 'updateView', viewId, name: 'Renamed' })
  assert.deepEqual(h.db().views[0]!.calculations, { title: 'countAll' })
})
test('reading what a foot cell says', () => {
  const on = '2026-11-02'
  assert.deepEqual(calcText('max', { type: 'number', value: 36 }, undefined, on, 'BK-'), { label: 'Max', value: 'BK-36' })
  assert.deepEqual(calcText('sum', { type: 'number', value: 1234.5 }, 'comma', on), { label: 'Sum', value: '1,234.5' })
  assert.deepEqual(calcText('average', { type: 'number', value: 337.3333333333 }, undefined, on), { label: 'Average', value: '337.33' })
  assert.deepEqual(calcText('average', { type: 'number', value: null }, undefined, on), { label: 'Average', value: '—' })
  assert.deepEqual(calcText('percentChecked', { type: 'percent', value: 33.33333 }, undefined, on), { label: 'Checked', value: '33.3%' })
  assert.deepEqual(calcText('dateRange', { type: 'days', value: 1 }, undefined, on), { label: 'Range', value: '1 day' })
  assert.deepEqual(calcText('earliest', { type: 'date', value: '2026-10-20' }, undefined, on), { label: 'Earliest', value: 'Oct 20' })
  assert.deepEqual(calcText('countPerGroup', { type: 'groups', percent: false, value: [{ group: 'todo', count: 3 }, { group: 'done', count: 1 }] }, undefined, on), { label: '', value: '○ 3  ● 1' })
})

// ---------- R3-12: row templates

/** "Reading list" with a template: values, a body with words and to-dos. */
function templated() {
  const h = reading()
  h.run({ type: 'create-template', databaseId: 'list', title: 'Review', pageId: 'tmpl' } as never)
  h.run({ type: 'set-values', pageId: 'tmpl', values: { kind: 'essay', pages: 10 } } as never)
  const doc = [
    { id: 'l', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Notes', styles: {} }], children: [] },
    { id: 'td', type: 'task', props: { taskId: '', role: 'reference', planDate: '' }, content: [{ type: 'text', text: 'Call the author', styles: {} }], children: [] },
    { id: 'blank', type: 'task', props: { taskId: '', role: 'reference', planDate: '' }, content: [], children: [] },
  ]
  h.run({ type: 'save-editor', pageId: 'tmpl', expectedContent: pageContentKey(h.page('tmpl')), document: JSON.stringify(doc) } as never)
  const fromIt = (pageId: string, values: Record<string, unknown> = {}, title = '') => h.run({ type: 'add-row', databaseId: 'list', pageId, title, values, template: 'tmpl', at } as never)
  return Object.assign(h, { fromIt })
}
test('a template is no row: not in views, counts, search or To-dos, and its to-dos make no task', () => {
  const h = templated()
  assert.equal(h.ws.tasks.some(t => t.title === 'Call the author'), false, 'no task yet')
  assert.equal(h.rows(view()).some(r => r.id === 'tmpl'), false)
  assert.equal(databaseRows(h.ws, 'list').some(r => r.id === 'tmpl'), false)
  assert.equal(templates(h.ws).some(p => p.id === 'tmpl'), false, 'nor the Templates list')
  assert.deepEqual(rowTemplates(h.ws, 'list').map(p => p.id), ['tmpl'])
  const found = (words: string) => search(buildSearchIndex(h.ws), words, today)
  assert.equal(found('Call the author').lines.length, 0)
  assert.equal(found('Review').pages.length, 0)
  assert.equal(newPageTemplate(h.ws, h.page('list')), undefined, "it isn't a default for pages")
})
test('a new row takes the values, title and body, and its to-dos are its own', () => {
  const h = templated()
  h.fromIt('one')
  h.fromIt('two')
  const one = h.page('one'), two = h.page('two')
  assert.equal(one.title, 'Review')
  assert.deepEqual(one.values, { kind: 'essay', pages: 10 })
  const nodes = (p: Page) => JSON.parse(p.document) as { id: string; type: string; props: { taskId?: string }; content: unknown }[]
  assert.equal(nodes(one).length, 3)
  assert.notEqual(nodes(one)[0]!.id, 'l', 'fresh ids')
  const own = (p: Page) => nodes(p)[1]!.props.taskId!
  const taskOf = (id: string) => h.ws.tasks.find(t => t.id === id)
  assert.equal(taskOf(own(one))?.title, 'Call the author')
  assert.notEqual(own(one), own(two), 'each its own task')
  assert.equal(h.ws.tasks.filter(t => t.title === 'Call the author').length, 2)
  assert.equal(taskOf(nodes(one)[2]!.props.taskId ?? ''), undefined, 'a blank to-do makes no task')
  assert.equal(h.rows(view()).some(r => r.id === 'one'), true)
})
test('what the view asks wins over the template, and a title of its own too', () => {
  const h = templated()
  h.fromIt('here', { kind: 'novel' }, 'My title')
  assert.equal(h.page('here').title, 'My title')
  assert.deepEqual(h.page('here').values, { kind: 'novel', pages: 10 })
})
test('a template with no status leaves a new row with the same default', () => {
  const h = templated()
  h.fromIt('one')
  const status = cellValue(h.db(), h.page('one'), 'status')
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'plain', title: '', at } as never)
  assert.equal(status, cellValue(h.db(), h.page('plain'), 'status'))
  const options = h.db().properties.find(p => p.id === 'status')!.options!
  const done = options.find(o => o.group === 'done')!.id
  h.run({ type: 'set-values', pageId: 'tmpl', values: { status: done } } as never)
  h.fromIt('finished')
  assert.equal(cellValue(h.db(), h.page('finished'), 'status'), done, 'and its status comes through')
})
test('a number is the row\'s own; a template has none to pass on', () => {
  const h = templated()
  h.change({ kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } })
  h.fromIt('one')
  assert.equal(h.page('one').values?.['@id'], 5)
  assert.equal(h.page('tmpl').values?.['@id'], undefined)
})
test('defaults: the view\'s over the database\'s, and a deleted one is no default', () => {
  const h = templated()
  h.run({ type: 'create-template', databaseId: 'list', title: 'Other', pageId: 'other' } as never)
  const viewId = h.db().views[0]!.id, first = () => h.db().views[0]!
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first()), undefined)
  h.change({ kind: 'setDefaultTemplate', templateId: 'tmpl' })
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first())?.id, 'tmpl')
  h.change({ kind: 'updateView', viewId, defaultTemplate: 'other' })
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first())?.id, 'other')
  h.change({ kind: 'updateView', viewId, defaultTemplate: null })
  assert.equal('defaultTemplate' in first(), false)
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first())?.id, 'tmpl')
  const del = h.run({ type: 'delete-template', pageId: 'tmpl' } as never)
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first()), undefined)
  h.run({ type: 'undo', targetOperationId: del.receipt.operationId } as never)
  assert.equal(defaultRowTemplate(h.ws, h.page('list'), first())?.id, 'tmpl', 'Undo brings it back')
  h.change({ kind: 'setDefaultTemplate', templateId: null })
  assert.equal('defaultTemplate' in h.db(), false)
})
test('a template deleted later leaves its rows alone; one from elsewhere is refused', () => {
  const h = templated()
  h.fromIt('one')
  const before = JSON.stringify(h.page('one'))
  h.run({ type: 'delete-template', pageId: 'tmpl' } as never)
  assert.equal(JSON.stringify(h.page('one')), before)
  assert.throws(() => h.fromIt('late'), /gone/)
  h.run({ type: 'create-template', title: 'A page template', pageId: 'pages' } as never)
  assert.throws(() => h.run({ type: 'add-row', databaseId: 'list', pageId: 'x', title: '', template: 'pages', at } as never), /gone/)
  assert.throws(() => h.run({ type: 'set-template-target', pageId: 'tmpl2', target: null } as never))
})
test('a row template can\'t be made a page default', () => {
  const h = templated()
  assert.throws(() => h.run({ type: 'set-template-target', pageId: 'tmpl', target: 'days' } as never), /Not a template/)
  assert.throws(() => h.run({ type: 'set-values', pageId: 'pages', values: {} } as never))
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'add-row', databaseId: 'list', pageId: 'p', title: '', template: 'tmpl', at } }).success, true)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'create-template', databaseId: 'list', title: '' } }).success, true)
})
