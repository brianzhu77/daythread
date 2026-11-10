// Databases R2: Board and Group (design §7.2, §7.3, §7.4): a view's rows in their groups, what a row stores in a group,
// the view's group fields, and a card's drop as one change with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { columnMoved, filterTree, hasFilter, rowColour, type ColourRule, sectionKey, splitSection, viewSection, viewSections, viewSubGroupBy, viewSubGroups, viewBoardCalculation, databaseRows, calcChoices, canWrap, calendarRows, cellValue, columnCalc, conditionHolds, inView, lostOnTypeChange, dateProperties, groupableProperties, groupValue, movedDate, startOfWeek, viewDateBy, newRowValues, noGroupKey, valueText, viewGroupBy, viewCalculations, viewGroups, viewColumns, viewRows, type CalcKind, type Condition, type Database, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { canHoldGroup, moveIntoGroup, moveIntoNewGroup, moveOutOfGroup, moveRulesOut, removeGroup, treeFields, withoutRule } from '../src/domain/filter-tree.ts'
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
  const novels: Condition = { by: 'kind', op: 'isAnyOf', value: ['novel'] }
  const long: Condition = { by: 'pages', op: 'gt', value: 350 }
  const titles = (v: View) => h.rows(v).map(r => r.id)
  assert.deepEqual(titles(view({ filter: [novels, long] })), ['dune'])
  assert.deepEqual(titles(view({ filter: [{ by: 'kind', op: 'isAnyOf', value: ['essay'] }, long], filterAny: true })), ['dune', 'ubik'])
  // A deleted property's rule, or one with no value yet, doesn't count: it neither lets everything in nor hides everything.
  const gone: Condition = { by: 'gone', op: 'isEmpty' }, unfinished: Condition = { by: 'note', op: 'contains' }
  assert.deepEqual(titles(view({ filter: [gone, long], filterAny: true })), ['dune'])
  assert.deepEqual(titles(view({ filter: [unfinished, long], filterAny: true })), ['dune'])
  assert.equal(titles(view({ filter: [gone, unfinished], filterAny: true })).length, 4)
  assert.equal(inView(h.db(), h.page('blank'), view({ filter: [novels], filterAny: true }), ctx), false)
})

test('a new row under any rule takes one value that shows it, or none and the notice (R3-4, §7.4)', () => {
  const h = reading()
  const novels: Condition = { by: 'kind', op: 'isAnyOf', value: ['novel'] }, sf: Condition = { by: 'tags', op: 'contains', value: ['sf'] }
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

// ---------- R3-14: wrap per property

test('a view keeps what it wraps, and it never touches another view or a row', () => {
  const h = reading()
  h.change({ kind: 'addView', view: view({ id: 'second', name: 'Second', columns: [{ id: 'note' }] }) })
  const viewId = h.db().views[0]!.id
  const columns = [{ id: 'note', width: 200, wrap: true as const }, { id: 'kind' }]
  h.change({ kind: 'updateView', viewId, columns, wrapName: true })
  assert.deepEqual(h.db().views[0]!.columns, columns)
  assert.equal(h.db().views[0]!.wrapName, true)
  assert.deepEqual(viewColumns(h.db(), h.db().views[0]!).map(c => [c.property.id, c.width, c.wrap]), [['note', 200, true], ['kind', undefined, undefined]])
  assert.deepEqual(h.db().views.find(v => v.id === 'second')!.columns, [{ id: 'note' }], 'another view is its own')
  h.change({ kind: 'updateView', viewId, name: 'Renamed' })
  assert.equal(h.db().views[0]!.wrapName, true, 'a rename keeps it')
  h.change({ kind: 'updateView', viewId, wrapName: false })
  assert.equal('wrapName' in h.db().views[0]!, false)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId, columns: [{ id: 'note', wrap: 'yes' }] } } }).success, false)
})
test('what can wrap', () => {
  assert.deepEqual(['text', 'url', 'email', 'phone', 'select', 'multiSelect', 'status', 'date', 'createdTime', 'editedTime'].filter(t => !canWrap(t as never)), [])
  assert.deepEqual(['number', 'checkbox', 'id'].filter(t => canWrap(t as never)), [])
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

// ---------- R3-24: calculations on a board

test('a board keeps one calculation, and it stops when it no longer fits', () => {
  const h = reading()
  const viewId = h.db().views[0]!.id, first = () => h.db().views[0]!
  assert.equal(viewBoardCalculation(h.db(), first()), null)
  h.change({ kind: 'updateView', viewId, boardCalculation: { by: 'pages', kind: 'sum' } })
  assert.deepEqual(viewBoardCalculation(h.db(), first()), { by: 'pages', kind: 'sum' })
  h.change({ kind: 'updateView', viewId, name: 'Renamed' })
  assert.deepEqual(first().boardCalculation, { by: 'pages', kind: 'sum' }, 'a rename keeps it')
  h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'text' })
  assert.equal(viewBoardCalculation(h.db(), first()), null, 'Sum on text: back to the count')
  h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'number' })
  assert.deepEqual(viewBoardCalculation(h.db(), first()), { by: 'pages', kind: 'sum' }, 'and back with the type')
  h.change({ kind: 'updateView', viewId, boardCalculation: null })
  assert.equal('boardCalculation' in first(), false)
  assert.throws(() => h.change({ kind: 'updateView', viewId, boardCalculation: { by: 'gone', kind: 'sum' } }))
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId, boardCalculation: { by: 'pages', kind: 'nonsense' } } } }).success, false)
})
test('its heads give the same numbers as a table foot over the same group', () => {
  const h = reading()
  const grouped = view({ layout: 'board', groupBy: 'kind' })
  const groups = viewGroups(h.db(), grouped, h.rows(grouped))!.shown
  const tabled = view({ groupBy: 'kind' })
  const inTable = viewGroups(h.db(), tabled, h.rows(tabled))!.shown
  assert.deepEqual(groups.map(g => columnCalc(h.db(), g.rows, 'pages', 'sum').value), inTable.map(g => columnCalc(h.db(), g.rows, 'pages', 'sum').value))
})

// ---------- R3-13: sub-groups

const twoLayers = (fields: Partial<View> = {}) => view({ groupBy: 'kind', subGroupBy: 'owned', ...fields })
test('a second layer sits inside each group, and needs a first', () => {
  const h = reading()
  const v = twoLayers()
  assert.equal(viewSubGroupBy(h.db(), v)?.id, 'owned')
  assert.equal(viewSubGroupBy(h.db(), view({ subGroupBy: 'owned' })), null, 'no group, no second layer')
  assert.equal(viewSubGroupBy(h.db(), view({ groupBy: 'kind', subGroupBy: 'kind' })), null, 'not the same property twice')
  assert.equal(viewSubGroupBy(h.db(), view({ groupBy: 'kind', subGroupBy: 'note' })), null, 'not what can\'t group')
  const novels = viewGroups(h.db(), v, h.rows(v))!.shown.find(g => g.key === 'novel')!
  assert.deepEqual(viewSubGroups(h.db(), v, novels.rows)!.shown.map(s => [s.key, s.rows.map(r => r.id)]), [['unchecked', ['emma']], ['checked', ['dune']]])
  const flat = viewSections(h.db(), v, h.rows(v))!.shown
  assert.deepEqual(flat.find(s => s.key === sectionKey('novel', 'checked'))?.rows.map(r => r.id), ['dune'])
  assert.equal(flat.find(s => s.key === sectionKey('novel', 'checked'))?.name, 'Novel · Checked')
  assert.deepEqual(viewSections(h.db(), view({ groupBy: 'kind' }), h.rows(view()))!.shown.map(s => s.key), ['novel', 'essay', noGroupKey], 'one layer: the groups')
})
test('a group with no rows keeps a section of its own, when the second layer has no options', () => {
  const h = reading()
  const v = view({ groupBy: 'status', subGroupBy: 'due', filter: [{ by: 'title', op: 'is', value: 'dune' }] })
  const flat = viewSections(h.db(), v, h.rows(v))!.shown
  const empty = viewGroups(h.db(), v, h.rows(v))!.shown.filter(g => !g.rows.length).map(g => g.key)
  assert.ok(empty.length > 0)
  for (const key of empty) assert.ok(flat.some(s => s.key === key), `${key} has its own`)
  assert.equal(flat.some(s => empty.includes(splitSection(s.key).group) && splitSection(s.key).sub !== undefined), false)
  // Its sub-groups all hidden, a group with rows keeps them hidden: it isn't empty.
  const hid = view({ groupBy: 'kind', subGroupBy: 'owned', hiddenSubGroups: ['checked', 'unchecked'] })
  assert.equal(viewSections(h.db(), hid, h.rows(hid))!.shown.some(s => s.key === 'novel'), false)
})
test("a board's cell is a place, though its group has no rows in that lane", () => {
  const h = reading()
  const v = view({ groupBy: 'kind', subGroupBy: 'due' })
  const rows = h.rows(v)
  const lanes = viewSubGroups(h.db(), v, rows)!.shown
  const groups = viewGroups(h.db(), v, rows)!.shown
  const key = groups.flatMap(g => lanes.map(l => sectionKey(g.key, l.key))).find(k => !viewSections(h.db(), v, rows)!.shown.some(s => s.key === k))
  assert.ok(key, 'this view has a cell with no rows')
  const cell = viewSection(h.db(), v, rows, key)!
  assert.deepEqual(cell.rows, [])
  assert.ok(cell.name.includes(' · '), 'named from both layers')
  assert.equal(viewSection(h.db(), v, rows, sectionKey(groups[0]!.key, 'gone')), null, 'a lane no longer there is no place')
  assert.equal(viewSection(h.db(), v, rows, 'gone'), null)
  assert.equal(viewSection(h.db(), v, rows, groups[0]!.key)?.key, groups[0]!.key, "a group's own key")
})
test('sections keep their own keys apart, with no value too', () => {
  assert.deepEqual(splitSection('novel'), { group: 'novel' })
  assert.deepEqual(splitSection(sectionKey('novel', noGroupKey)), { group: 'novel', sub: noGroupKey })
})
test('hide empty covers both layers, and sub-groups hide on their own', () => {
  const h = reading()
  const v = twoLayers({ groupBy: 'kind', subGroupBy: 'status' })
  const groupOf = (x: View, key: string) => viewGroups(h.db(), x, h.rows(x))!.shown.find(g => g.key === key)!
  const all = viewSubGroups(h.db(), v, groupOf(v, 'novel').rows)!.shown.map(s => s.key)
  assert.ok(all.length >= 3, 'a status offers each of its options')
  const hiding = { ...v, hideEmptyGroups: true }
  assert.equal(viewSubGroups(h.db(), hiding, groupOf(hiding, 'novel').rows)!.shown.every(s => s.rows.length > 0), true)
  const first = all[0]!
  const hid = { ...v, hiddenSubGroups: [first] }
  const subs = viewSubGroups(h.db(), hid, h.rows(hid))!
  assert.equal(subs.shown.some(s => s.key === first), false)
  assert.equal(subs.hidden.some(s => s.key === first), true)
  assert.equal(viewGroups(h.db(), hid, h.rows(hid))!.shown.length, viewGroups(h.db(), v, h.rows(v))!.shown.length, 'the groups are as they were')
})
test('+ New under a section starts with both values', () => {
  const h = reading()
  const v = twoLayers()
  assert.deepEqual(newRowValues(h.db(), v, ctx, sectionKey('essay', 'checked')).values, { kind: 'essay', owned: true })
  assert.deepEqual(newRowValues(h.db(), v, ctx, sectionKey(noGroupKey, 'unchecked')).values, {})
  assert.deepEqual(newRowValues(h.db(), v, ctx, 'essay').values, { kind: 'essay' }, 'a group alone sets its own')
})
test('a view keeps its second layer, its date steps and what it hides; null clears', () => {
  const h = reading()
  const viewId = h.db().views[0]!.id, first = () => h.db().views[0]!
  h.change({ kind: 'updateView', viewId, groupBy: 'kind', subGroupBy: 'due', subGroupDateBy: 'week', hiddenSubGroups: ['x'] })
  assert.deepEqual([first().subGroupBy, first().subGroupDateBy, first().hiddenSubGroups], ['due', 'week', ['x']])
  h.change({ kind: 'updateView', viewId, name: 'Renamed' })
  assert.equal(first().subGroupBy, 'due', 'a rename keeps it')
  h.change({ kind: 'updateView', viewId, subGroupBy: null, hiddenSubGroups: [] })
  assert.equal('subGroupBy' in first(), false)
  assert.equal('hiddenSubGroups' in first(), false)
  assert.throws(() => h.change({ kind: 'updateView', viewId, subGroupBy: 'note' }), /Can't group/)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId, subGroupBy: null } } }).success, true)
})
test('one set-values moves both layers, with one Undo', () => {
  const h = reading()
  const r = h.run({ type: 'set-values', pageId: 'dune', values: { kind: 'essay', owned: null }, expected: { kind: 'novel', owned: true }, at } as never)
  assert.equal(cellValue(h.db(), h.page('dune'), 'kind'), 'essay')
  assert.equal(cellValue(h.db(), h.page('dune'), 'owned'), false)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId } as never)
  assert.equal(cellValue(h.db(), h.page('dune'), 'kind'), 'novel')
  assert.equal(cellValue(h.db(), h.page('dune'), 'owned'), true)
})

test('R4-12: the highest rule that matches colours a row; a rule whose property is gone matches nothing', () => {
  const h = reading()
  const rule = (id: string, by: string, value: string, tint: ColourRule['tint']): ColourRule => ({ id, rule: { by, op: 'isAnyOf', value: [value] }, tint })
  const v = view({ colourRules: [rule('a', 'gone', 'x', 'red'), rule('b', 'kind', 'novel', 'green'), rule('c', 'kind', 'novel', 'blue')] })
  const dune = h.rows(view()).find(r => r.id === 'dune')!, ubik = h.rows(view()).find(r => r.id === 'ubik')!
  assert.equal(rowColour(h.db(), v, dune, ctx)?.id, 'b', 'first match, top down')
  assert.equal(rowColour(h.db(), v, ubik, ctx), null)
  assert.equal(rowColour(h.db(), view(), dune, ctx), null, 'no rules, no colour')
})
test('R4-12, R4-13: colour rules and a frozen column are saved on the view, and clear', () => {
  const h = reading()
  const id = h.db().views[0]!.id
  h.change({ kind: 'updateView', viewId: id, colourRules: [{ id: 'r', rule: { by: 'kind', op: 'isEmpty' }, tint: 'gray' }], frozenThrough: 'kind' })
  assert.equal(h.db().views[0]!.colourRules?.[0]!.tint, 'gray')
  assert.equal(h.db().views[0]!.frozenThrough, 'kind')
  h.change({ kind: 'updateView', viewId: id, name: 'Kept' })
  assert.equal(h.db().views[0]!.frozenThrough, 'kind', 'another change keeps them')
  h.change({ kind: 'updateView', viewId: id, colourRules: [], frozenThrough: null })
  assert.equal(h.db().views[0]!.colourRules, undefined)
  assert.equal(h.db().views[0]!.frozenThrough, undefined)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: id, frozenThrough: null, colourRules: [{ id: 'r', rule: { by: 'kind', op: 'isEmpty' }, tint: 'red', scope: 'property' }] } } }).success)
})

test('a column dropped elsewhere (R4-18): crossing the frozen edge changes only which columns are frozen (R4-13)', () => {
  const c = (...ids: string[]) => ids.map(id => ({ id }))
  const ids = (r: ReturnType<typeof columnMoved>) => r?.columns.map(x => x.id).join()
  const all = c('a', 'b', 'c', 'd')
  assert.equal(ids(columnMoved(all, undefined, 'a', 'c')), 'b,a,c,d')
  assert.equal(ids(columnMoved(all, undefined, 'd', 'a')), 'd,a,b,c')
  assert.equal(ids(columnMoved(all, undefined, 'a', null)), 'b,c,d,a')
  assert.equal(columnMoved(all, undefined, 'a', 'a'), null, 'on itself')
  assert.equal(columnMoved(all, undefined, 'a', 'b'), null, 'where it already is')
  assert.equal(columnMoved(all, undefined, 'd', null), null, 'already last')
  assert.equal(columnMoved(all, undefined, 'gone', 'a'), null)
  assert.equal(columnMoved(all, undefined, 'a', 'gone'), null)
  assert.deepEqual(columnMoved(c('a', 'b'), undefined, 'b', 'a'), { columns: c('b', 'a') }, 'no frozen, nothing said about them')
  // a b | c d: into the frozen, it joins them.
  assert.deepEqual(columnMoved(all, 'b', 'd', 'b'), { columns: c('a', 'd', 'b', 'c') }, 'b is still the last frozen')
  assert.deepEqual(columnMoved(all, 'b', 'c', 'a'), { columns: c('c', 'a', 'b', 'd') }, 'b is still the last frozen')
  // Out past the edge, it leaves them.
  assert.deepEqual(columnMoved(all, "b", "a", "d"), { columns: c("b", "c", "a", "d") }, "b is still the last frozen")
  assert.deepEqual(columnMoved(all, 'b', 'b', 'd'), { columns: c('a', 'c', 'b', 'd'), frozenThrough: 'a' })
  assert.deepEqual(columnMoved(all, 'a', 'a', 'c'), { columns: c('b', 'a', 'c', 'd'), frozenThrough: null }, 'the only one frozen leaves: none are')
  // Right on the edge, it stays as it was.
  assert.deepEqual(columnMoved(all, 'b', 'a', 'c'), { columns: c('b', 'a', 'c', 'd'), frozenThrough: 'a' }, 'frozen, last of them now')
  assert.deepEqual(columnMoved(all, 'b', 'd', 'c'), { columns: c('a', 'b', 'd', 'c') }, 'not frozen, first of the rest')
})

test('duplicating a property (R4-18): its settings and values, beside it, with its own name; one side of a link', () => {
  const h = reading()
  h.change({ kind: 'addProperty', property: { id: 'kind2', name: 'Kind copy', type: 'text' } })
  const views = h.db().views[0]!
  h.change({ kind: 'updateView', viewId: views.id, columns: [{ id: 'kind', width: 200 }, { id: 'kind2' }] })
  h.change({ kind: 'duplicateProperty', propertyId: 'kind', newId: 'k3' })
  const made = h.db().properties.find(p => p.id === 'k3')!
  assert.equal(made.name, 'Kind copy 2')
  assert.deepEqual(made.options, h.db().properties.find(p => p.id === 'kind')!.options)
  assert.deepEqual(h.db().views[0]!.columns.map(c => c.id), ['kind', 'k3', 'kind2'])
  assert.equal(h.db().views[0]!.columns[1]!.width, 200)
  assert.equal(h.page('dune').values?.k3, 'novel', 'its values come too')
  assert.throws(() => h.change({ kind: 'duplicateProperty', propertyId: 'kind', newId: 'k3' }), /Invalid id/)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'duplicateProperty', propertyId: 'kind', newId: 'k4' } } }).success)
})

test('a property inserted beside a column (R4-18): placed there in that view, last in the others, in one change', () => {
  const h = reading()
  const a = h.db().views[0]!.id
  h.change({ kind: 'addView', view: { id: 'other', name: 'Other', layout: 'table', columns: [{ id: 'kind' }, { id: 'pages' }], sort: [], filter: [] } })
  h.change({ kind: 'updateView', viewId: a, columns: [{ id: 'kind' }, { id: 'pages' }] })
  h.change({ kind: 'addProperty', property: { id: 'n1', name: 'Between', type: 'text' }, viewId: a, beforeId: 'pages' })
  assert.deepEqual(h.db().views[0]!.columns.map(c => c.id), ['kind', 'n1', 'pages'])
  assert.deepEqual(h.db().views.find(v => v.id === 'other')!.columns.map(c => c.id), ['kind', 'pages', 'n1'])
  h.change({ kind: 'addProperty', property: { id: 'n2', name: 'Gone', type: 'text' }, viewId: a, beforeId: 'not-a-column' })
  assert.equal(h.db().views[0]!.columns.at(-1)!.id, 'n2', 'a column gone meanwhile: last')
})

test('filter groups: all and any across three layers, and what can\'t be read counts neither way (filter-groups.md §3)', () => {
  const h = reading()
  const novels: Condition = { by: 'kind', op: 'isAnyOf', value: ['novel'] }, essays: Condition = { by: 'kind', op: 'isAnyOf', value: ['essay'] }
  const long: Condition = { by: 'pages', op: 'gt', value: 350 }, short: Condition = { by: 'pages', op: 'lt', value: 350 }
  const gone: Condition = { by: 'gone', op: 'isEmpty' }, unfinished: Condition = { by: 'note', op: 'contains' }
  const titles = (v: View) => h.rows(v).map(r => r.id)
  const everything = titles(view())
  // A top rule and a group: the rule, and one or the other.
  assert.deepEqual(titles(view({ filter: [novels], filterGroups: [{ any: true, rules: [long, short] }] })), ['dune', 'emma'])
  assert.deepEqual(titles(view({ filter: [novels], filterGroups: [{ rules: [long] }] })), ['dune'])
  // Any at the top: the group is one of the choices, and holds together.
  assert.deepEqual(titles(view({ filter: [essays], filterAny: true, filterGroups: [{ rules: [novels, long] }] })), ['dune', 'ubik'])
  // A third layer works the same.
  assert.deepEqual(titles(view({ filterGroups: [{ rules: [novels], groups: [{ any: true, rules: [long, { by: 'pages', op: 'lt', value: 0 }] }] }] })), ['dune'])
  // An empty group, and a group of only rules that can't be read, count neither way, under all or any.
  for (const hollow of [{ rules: [] }, { rules: [gone] }, { any: true as const, rules: [gone, unfinished] }, { rules: [], groups: [{ rules: [gone] }] }]) {
    assert.deepEqual(titles(view({ filterGroups: [hollow] })), everything)
    assert.deepEqual(titles(view({ filter: [novels], filterAny: true, filterGroups: [hollow] })), titles(view({ filter: [novels], filterAny: true })))
    assert.deepEqual(titles(view({ filter: [novels], filterGroups: [hollow] })), titles(view({ filter: [novels] })))
  }
  // A rule that can't be read beside one that can.
  assert.deepEqual(titles(view({ filterGroups: [{ any: true, rules: [gone, long] }] })), ['dune'])
  // No groups: exactly as before.
  assert.equal(inView(h.db(), h.page('blank'), view({ filter: [novels], filterAny: true }), ctx), false)
})

test('filter groups: a new row takes a value where one is needed, walking the tree, or none and the notice (§3, §7.4)', () => {
  const h = reading()
  const novels: Condition = { by: 'kind', op: 'isAnyOf', value: ['novel'] }, sf: Condition = { by: 'tags', op: 'contains', value: ['sf'] }
  const long: Condition = { by: 'pages', op: 'gt', value: 350 }, exact: Condition = { by: 'pages', op: 'eq', value: 400 }
  // All at the top: the rule's value and the group's.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [novels], filterGroups: [{ rules: [sf] }] }), ctx), { title: '', values: { kind: 'novel', tags: ['sf'] }, visible: true })
  // Any in a group: its first single value that works, and only one.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [novels], filterGroups: [{ any: true, rules: [long, sf, exact] }] }), ctx), { title: '', values: { kind: 'novel', tags: ['sf'] }, visible: true })
  // Any at the top, and only a group can give one: the whole group's values, as it must hold together.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [long], filterAny: true, filterGroups: [{ rules: [novels, sf] }] }), ctx), { title: '', values: { kind: 'novel', tags: ['sf'] }, visible: true })
  // Any at the top, and a group that can't get there: what it tried is put back, and the next one is taken.
  assert.deepEqual(newRowValues(h.db(), view({ filterAny: true, filter: [], filterGroups: [{ rules: [novels, long] }, { rules: [sf] }] }), ctx), { title: '', values: { tags: ['sf'] }, visible: true })
  // Nothing gives one: no values, and hidden, so the notice says so.
  assert.deepEqual(newRowValues(h.db(), view({ filter: [], filterGroups: [{ any: true, rules: [long] }] }), ctx), { title: '', values: {}, visible: false })
  // Third layer.
  assert.deepEqual(newRowValues(h.db(), view({ filterGroups: [{ rules: [], groups: [{ any: true, rules: [long, sf] }] }] }), ctx).values, { tags: ['sf'] })
})

test('filter groups: stored only as far as three layers and twenty rules, held by other edits, and gone when emptied', () => {
  const h = reading()
  const v = () => h.db().views[0]!
  const rule = { by: 'pages', op: 'gt', value: 1 } as const
  h.change({ kind: 'updateView', viewId: v().id, filterGroups: [{ any: true, rules: [rule], groups: [{ rules: [rule] }] }] })
  assert.deepEqual(v().filterGroups, [{ any: true, rules: [rule], groups: [{ rules: [rule] }] }])
  // Another edit, or one to the top rules, leaves them.
  h.change({ kind: 'updateView', viewId: v().id, name: 'Kept' }); h.change({ kind: 'updateView', viewId: v().id, filter: [rule], filterAny: true })
  assert.equal(v().filterGroups?.length, 1)
  assert.equal(hasFilter(v()), true)
  // A fourth layer, and a rule past twenty, counted across the layers, are refused.
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, filterGroups: [{ rules: [], groups: [{ rules: [], groups: [{ rules: [rule] }] }] }] }), /Invalid filter/)
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, filter: [rule], filterGroups: [{ rules: Array(20).fill(rule) }] }), /Invalid filter/)
  // A new rule must be on a column; one already there on a deleted property may move into a group.
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, filterGroups: [{ rules: [{ by: 'nope', op: 'isEmpty' }] }] }), /Invalid filter/)
  h.change({ kind: 'updateView', viewId: v().id, filter: [{ by: 'note', op: 'isEmpty' }], filterGroups: [] })
  h.change({ kind: 'removeProperty', propertyId: 'note' })
  h.change({ kind: 'updateView', viewId: v().id, filter: [], filterGroups: [{ rules: [{ by: 'note', op: 'isEmpty' }] }] })
  assert.equal(v().filterGroups?.[0]?.rules[0]?.by, 'note')
  // Emptied: the field goes, so the view reads as one with no groups.
  h.change({ kind: 'updateView', viewId: v().id, filter: [], filterGroups: [] })
  assert.equal('filterGroups' in v(), false)
  assert.equal(hasFilter(v()), false)
  // A view made with them keeps them, as far as the limit.
  const added = { ...view({ id: 'copied', filterGroups: [{ rules: [rule] }] }) }
  h.change({ kind: 'addView', view: added })
  assert.deepEqual(h.db().views.find(x => x.id === 'copied')!.filterGroups, [{ rules: [rule] }])
  // The command's shape stops at three layers, so nothing deeper reaches the store.
  const parsed = commandSchema.parse({ operationId: 'a', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: 'v', filterGroups: [{ rules: [rule], groups: [{ rules: [rule], groups: [{ rules: [rule] }] }] }] } } }) as never as { action: { change: { filterGroups: { groups: object[] }[] } } }
  assert.equal('groups' in parsed.action.change.filterGroups[0]!.groups[0]!, false)
})

test('filter groups: the sheet\'s moves keep every rule, and no group stands empty', () => {
  const a: Condition = { by: 'a', op: 'isEmpty' }, b: Condition = { by: 'b', op: 'isEmpty' }, c: Condition = { by: 'c', op: 'isEmpty' }
  assert.deepEqual(moveIntoNewGroup({ rules: [a, b] }, 0), { rules: [b], groups: [{ rules: [a] }] })
  assert.deepEqual(moveIntoGroup({ rules: [a], groups: [{ rules: [b] }] }, 0, 0), { rules: [], groups: [{ rules: [b, a] }] })
  // Out, and the group goes with its last rule, under any layer.
  assert.deepEqual(moveOutOfGroup({ rules: [], groups: [{ rules: [a] }] }, [0], 0), { rules: [a] })
  assert.deepEqual(moveOutOfGroup({ rules: [], groups: [{ rules: [b], groups: [{ rules: [a, c] }] }] }, [0, 0], 1), { rules: [], groups: [{ rules: [b, c], groups: [{ rules: [a] }] }] })
  assert.deepEqual(withoutRule({ rules: [a], groups: [{ rules: [b] }] }, [0], 0), { rules: [a] })
  assert.deepEqual(withoutRule({ rules: [], groups: [{ rules: [b], groups: [{ rules: [c] }] }] }, [0, 0], 0), { rules: [], groups: [{ rules: [b] }] })
  // A group's rules join the layer above, and groups inside it come up too, so they still fit.
  assert.deepEqual(moveRulesOut({ rules: [a], groups: [{ any: true, rules: [b], groups: [{ rules: [c] }] }] }, 0), { rules: [a, b], groups: [{ rules: [c] }] })
  assert.deepEqual(removeGroup({ rules: [a], groups: [{ rules: [b] }] }, 0), { rules: [a] })
  assert.equal(canHoldGroup([]), true); assert.equal(canHoldGroup([0]), true); assert.equal(canHoldGroup([0, 0]), false)
  assert.deepEqual(treeFields({ any: true, rules: [a] }), { filter: [a], filterAny: true, filterGroups: [] })
})

test('filter groups: a calendar move, this page\'s day in a group, and the opening day read the same tree (§3)', () => {
  const h = reading()
  const novels: Condition = { by: 'kind', op: 'isAnyOf', value: ['novel'] }
  const onPageDay = { by: 'due', op: 'is', value: { relative: 'pageDate' } } as const
  const tree = view({ filter: [novels], filterGroups: [{ any: true, rules: [onPageDay] }] })
  assert.deepEqual(viewRows(h.ws, 'list', tree, { ...ctx, pageDate: '2026-10-25' }).map(r => r.id), ['dune'])
  // A page with no day of its own: that rule can't be read, so its group counts neither way, and the top rule decides.
  assert.deepEqual(viewRows(h.ws, 'list', tree, ctx).map(r => r.id), ['dune', 'emma'])
  // A row moved out of what a group holds reads as hidden, as a board's or calendar's move checks.
  const dune = h.page('dune')
  assert.equal(inView(h.db(), dune, { ...tree }, { ...ctx, pageDate: '2026-10-25' }), true)
  assert.equal(inView(h.db(), { ...dune, values: { ...dune.values, due: { start: '2026-10-26' } } } as Page, { ...tree }, { ...ctx, pageDate: '2026-10-25' }), false)
  // The tree is what's looked through for this page's day, at any layer.
  assert.ok(JSON.stringify(filterTree(tree)).includes('"relative":"pageDate"'))
})

