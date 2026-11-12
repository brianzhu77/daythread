// Dashboard step 1 (dashboard.md, D13 G6-1, G6-2, G6-4): rows of widgets, each its own copy of a view of any database, changed
// only by commands that name their widget or row, so two tabs' changes touch different fields.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { allowedSplit, firstWidgetView, shownWidths, type Dashboard } from '../src/domain/dashboard.ts'
import type { View } from '../src/domain/database.ts'
import { todosSourceId } from '../src/domain/todos-id.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-12T10:00:00.000Z'
function setup() {
  const h = harness()
  const C = (pageId: string, change: unknown) => h.run({ type: 'change-database', pageId, change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C('runs', { kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }] } })
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { st: 'a' }, at } as never)
  h.run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
  h.run({ type: 'create-database', pageId: 'home', homeBlockId: null, title: 'Home' })
  const runs = () => h.page('runs').database!, books = () => h.page('books').database!
  const D = (change: Record<string, unknown>) => C('home', { viewId: 'dash', ...change })
  C('home', { kind: 'addDashboard', view: { id: 'dash', name: 'Dashboard' }, rows: [{ id: 'row1', widgets: [{ id: 'w1', source: 'runs', view: firstWidgetView(runs(), 'v1') }] }] })
  const dash = (): Dashboard => h.page('home').database!.views.find(v => v.id === 'dash')!.dashboard!
  const widget = (id: string) => dash().rows.flatMap(r => r.widgets).find(w => w.id === id)
  const add = (id: string, source = 'books', rowId: string | null = 'row1', newRowId?: string) => D({ kind: 'addWidget', widget: { id, source, view: firstWidgetView(source === 'runs' ? runs() : books(), `v-${id}`) }, rowId, beforeId: null, ...(newRowId ? { newRowId } : {}) })
  return { h, C, D, dash, widget, add, runs, books }
}
const shape = (d: Dashboard) => d.rows.map(r => `${r.id}:${r.widgets.map(w => `${w.id}/${w.width}`).join(',')}`).join(' | ')

test('a dashboard opens with one widget, its own copy of a view of another database, with its own ids', () => {
  const { h, dash, runs } = setup()
  assert.equal(shape(dash()), 'row1:w1/12')
  const w = dash().rows[0]!.widgets[0]!
  assert.equal(w.source, 'runs')
  assert.equal(w.view.id, 'v1')
  assert.notEqual(w.view.id, runs().views[0]!.id, 'no link back to the view it came from')
  assert.equal(h.page('home').database!.views.find(v => v.id === 'dash')!.layout, 'dashboard')
  assert.equal(dash().rows[0]!.height, 320)
})

test('a dashboard is made only by addDashboard, and stays one', () => {
  const { C, h } = setup()
  assert.throws(() => C('home', { kind: 'addView', view: { id: 'x', name: 'X', layout: 'dashboard', columns: [], sort: [], filter: [] } }), /Unknown view type/)
  assert.throws(() => C('home', { kind: 'updateView', viewId: 'dash', layout: 'table' }), /stays a dashboard/)
  const tableId = h.page('home').database!.views[0]!.id
  assert.throws(() => C('home', { kind: 'updateView', viewId: tableId, layout: 'dashboard' }), /stays a dashboard/)
})

test('renaming the dashboard view keeps its rows, and its reserved filter, untouched', () => {
  const { C, h, dash } = setup()
  h.page('home').database!.views.find(v => v.id === 'dash')!.dashboard!.filter = [{ by: 'st', op: 'isAnyOf', value: ['a'] }]
  const before = JSON.stringify(dash())
  C('home', { kind: 'updateView', viewId: 'dash', name: 'This month' })
  assert.equal(JSON.stringify(dash()), before)
})

test('a widget joining or leaving a row splits it equally; at most 4 to a row and 12 in all', () => {
  const { add, dash, D } = setup()
  add('w2'); assert.equal(shape(dash()), 'row1:w1/6,w2/6')
  add('w3'); add('w4'); assert.equal(shape(dash()), 'row1:w1/3,w2/3,w3/3,w4/3')
  assert.throws(() => add('w5'), /4 widgets to a row/)
  D({ kind: 'removeWidget', widgetId: 'w2' }); assert.equal(shape(dash()), 'row1:w1/4,w3/4,w4/4')
  for (let i = 0; i < 9; i++) add(`n${i}`, 'books', null, `nr${i}`)
  assert.throws(() => add('n9', 'books', null, 'nr9'), /12 widgets at most/)
})

test('moving: into another row re-divides both, an emptied row goes, and a new row takes its id', () => {
  const { add, dash, D } = setup()
  add('w2'); add('w3', 'books', null, 'row2')
  D({ kind: 'moveWidget', widgetId: 'w3', toRowId: 'row1', beforeId: 'w2' })
  assert.equal(shape(dash()), 'row1:w1/4,w3/4,w2/4')
  D({ kind: 'moveWidget', widgetId: 'w1', toRowId: null, newRowId: 'row3', rowBeforeId: null, beforeId: null })
  assert.equal(shape(dash()), 'row1:w3/6,w2/6 | row3:w1/12')
  assert.throws(() => D({ kind: 'moveWidget', widgetId: 'w2', toRowId: null, newRowId: 'row1', beforeId: null }), /Invalid id/, 'a new row id already used')
})

test('a swap trades place and width with its neighbour in reading order, across rows too; nothing else moves', () => {
  const { add, dash, D } = setup()
  add('w2'); add('w3', 'books', null, 'row2')
  D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w1', rightId: 'w2', leftWidth: 4 })
  D({ kind: 'swapWidget', widgetId: 'w2', withId: 'w3' })
  assert.equal(shape(dash()), 'row1:w1/4,w3/8 | row2:w2/12')
  assert.throws(() => D({ kind: 'swapWidget', widgetId: 'w1', withId: 'w2' }), /Not next to each other/)
  D({ kind: 'swapWidget', widgetId: 'w1', withId: 'w3' })
  assert.equal(shape(dash()), 'row1:w3/8,w1/4 | row2:w2/12', 'within one row each keeps its own width')
})

test('a split is between neighbours, and only to an allowed split', () => {
  const { h, add, dash, D, C, runs } = setup()
  add('w2')
  D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w1', rightId: 'w2', leftWidth: 4 })
  assert.equal(shape(dash()), 'row1:w1/4,w2/8')
  assert.throws(() => D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w1', rightId: 'w2', leftWidth: 5 }), /can't split/)
  assert.throws(() => D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w2', rightId: 'w1', leftWidth: 6 }), /Not next to each other/)
  // Three widgets: 4+4+4, or 3+3+6 in any order, so a handle trades a 3 and a 6.
  C('home', { kind: 'addDashboard', view: { id: 'd3', name: 'Three' }, rows: [{ id: 'r3', widgets: ['a', 'b', 'c'].map((x, i) => ({ id: `t${x}`, width: [3, 3, 6][i], source: 'runs', view: firstWidgetView(runs(), `tv${x}`) })) }] })
  C('home', { kind: 'sizeSplit', viewId: 'd3', rowId: 'r3', leftId: 'tb', rightId: 'tc', leftWidth: 6 })
  const d3 = h.page('home').database!.views.find(v => v.id === 'd3')!.dashboard!
  assert.equal(shape(d3), 'r3:ta/3,tb/6,tc/3')
})

test('row heights snap to 40 px between 160 and 800', () => {
  const { D, dash } = setup()
  D({ kind: 'sizeRow', rowId: 'row1', height: 437 }); assert.equal(dash().rows[0]!.height, 440)
  D({ kind: 'sizeRow', rowId: 'row1', height: 20 }); assert.equal(dash().rows[0]!.height, 160)
  D({ kind: 'sizeRow', rowId: 'row1', height: 5000 }); assert.equal(dash().rows[0]!.height, 800)
})

test('duplicate: new ids, a deep copy, right after the original or in a new row under a full one', () => {
  const { add, dash, D, widget } = setup()
  D({ kind: 'duplicateWidget', widgetId: 'w1', newId: 'w1b', newViewId: 'v1b', newRowId: 'unused' })
  assert.equal(shape(dash()), 'row1:w1/6,w1b/6')
  assert.equal(widget('w1b')!.view.id, 'v1b')
  D({ kind: 'updateWidget', widgetId: 'w1b', fields: { name: 'Copy' } })
  assert.notEqual(widget('w1')!.view.name, 'Copy', 'its own settings, not shared')
  add('w3'); add('w4')
  D({ kind: 'duplicateWidget', widgetId: 'w1', newId: 'w1c', newViewId: 'v1c', newRowId: 'row2' })
  assert.equal(shape(dash()), 'row1:w1/3,w1b/3,w3/3,w4/3 | row2:w1c/12')
  assert.throws(() => D({ kind: 'duplicateWidget', widgetId: 'w1', newId: 'w1b', newViewId: 'v9', newRowId: 'row9' }), /Invalid id/)
})

test("a widget's settings: its own filter, cleaned against its source, never touching the source's views", () => {
  const { D, widget, runs } = setup()
  const before = JSON.stringify(runs().views)
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } })
  assert.equal(widget('w1')!.view.filter.length, 1)
  assert.equal(JSON.stringify(runs().views), before)
  assert.throws(() => D({ kind: 'updateWidget', widgetId: 'w1', fields: { layout: 'form' } }), /can't be that view/)
  assert.throws(() => D({ kind: 'updateWidget', widgetId: 'nope', fields: { name: 'x' } }), /widget's gone/)
})

test('a source deleted keeps the widget, its settings and its place; its settings refuse to change; the others carry on', () => {
  const { h, add, D, dash, widget } = setup()
  add('w2')
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } })
  h.run({ type: 'delete-page', pageId: 'runs', at } as never)
  assert.equal(shape(dash()), 'row1:w1/6,w2/6')
  assert.equal(widget('w1')!.view.filter.length, 1, 'nothing erased')
  assert.throws(() => D({ kind: 'updateWidget', widgetId: 'w1', fields: { name: 'x' } }), /database is gone/)
  D({ kind: 'updateWidget', widgetId: 'w2', fields: { name: 'Still fine' } })
  assert.equal(widget('w2')!.view.name, 'Still fine')
  D({ kind: 'removeWidget', widgetId: 'w1' })
  assert.equal(shape(dash()), 'row1:w2/12')
})

test('a property removed from the source leaves the widget\'s rule on it as it was', () => {
  const { C, D, widget } = setup()
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } })
  C('runs', { kind: 'removeProperty', propertyId: 'st' })
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { name: 'Renamed' } })
  assert.equal(widget('w1')!.view.filter[0]?.by, 'st')
})

test('removing a widget leaves every row of its source, says "View removed", and Undo brings it back', () => {
  const { h, D, dash } = setup()
  const rows = h.ws.pages.filter(p => p.parentId === 'runs').length
  const r = D({ kind: 'removeWidget', widgetId: 'w1' })
  assert.equal(r.receipt.message, 'View removed')
  assert.equal(h.ws.pages.filter(p => p.parentId === 'runs').length, rows)
  assert.equal(dash().rows.length, 0)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId } as never)
  assert.equal(shape(dash()), 'row1:w1/12')
})

test('two tabs: a move in one and a filter edit in the other both survive, in either order', () => {
  for (const order of ['move first', 'filter first']) {
    const { add, D, dash, widget } = setup()
    add('w2', 'books', null, 'row2')
    const move = { kind: 'moveWidget', widgetId: 'w2', toRowId: 'row1', beforeId: null }
    const filter = { kind: 'updateWidget', widgetId: 'w1', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } }
    // Each was built in its own tab before seeing the other, and is sent as it was built, as a Retry sends it.
    if (order === 'move first') { D(move); D(filter) } else { D(filter); D(move) }
    assert.equal(shape(dash()), 'row1:w1/6,w2/6', order)
    assert.equal(widget('w1')!.view.filter.length, 1, order)
  }
})

test('Undo of a widget change is refused once anything has changed since', () => {
  const { h, D, add } = setup()
  add('w2')
  const r = D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w1', rightId: 'w2', leftWidth: 4 })
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { name: 'Later' } })
  assert.throws(() => h.run({ type: 'undo', targetOperationId: r.receipt.operationId } as never), /Cannot undo after later changes/)
})

test('a widget from To-dos', () => {
  const { D, dash } = setup()
  D({ kind: 'addWidget', widget: { id: 'td', source: todosSourceId, view: { id: 'tdv', name: 'To-dos', layout: 'table', columns: [], sort: [], filter: [] } as View }, rowId: 'row1', beforeId: null })
  assert.equal(shape(dash()), 'row1:w1/6,td/6')
})

test('widths read as stored when allowed, and as an equal split otherwise, without saving it', () => {
  const row = { id: 'r', height: 320, widgets: [{ width: 5 }, { width: 7 }] } as never
  assert.deepEqual(shownWidths(row), [6, 6])
  assert.deepEqual((row as { widgets: { width: number }[] }).widgets.map(w => w.width), [5, 7])
  assert.ok(allowedSplit([3, 6, 3]) && !allowedSplit([4, 3, 5]) && allowedSplit([12]))
})

test('the schema bounds every command', () => {
  const ok = (change: unknown) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'home', change } }).success
  assert.ok(ok({ kind: 'sizeSplit', viewId: 'd', rowId: 'r', leftId: 'a', rightId: 'b', leftWidth: 4 }))
  assert.ok(ok({ kind: 'updateWidget', viewId: 'd', widgetId: 'w', fields: { name: 'x' } }))
  assert.equal(ok({ kind: 'sizeSplit', viewId: 'd', rowId: 'r', leftId: 'a', rightId: 'b', leftWidth: 4.5 }), false)
  assert.equal(ok({ kind: 'addDashboard', view: { id: 'd', name: 'D' }, rows: Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, widgets: [] })) }), false)
})

test("a drop back where it was is refused and changes nothing: in its own row, or a lone widget's own row (Ratchet 29f73fd7)", () => {
  const { add, dash, D } = setup()
  const before = shape(dash())
  assert.throws(() => D({ kind: 'moveWidget', widgetId: 'w1', toRowId: 'row1', beforeId: null }), /Already there/)
  assert.throws(() => D({ kind: 'moveWidget', widgetId: 'w1', toRowId: null, newRowId: 'x', rowBeforeId: null, beforeId: null }), /Already there/)
  assert.throws(() => D({ kind: 'moveWidget', widgetId: 'w1', toRowId: null, newRowId: 'x', rowBeforeId: 'row1', beforeId: null }), /Already there/)
  assert.equal(shape(dash()), before)
  add('w2'); D({ kind: 'sizeSplit', rowId: 'row1', leftId: 'w1', rightId: 'w2', leftWidth: 4 })
  D({ kind: 'moveWidget', widgetId: 'w2', toRowId: 'row1', beforeId: 'w1' })
  assert.equal(shape(dash()), 'row1:w2/8,w1/4', 'reordered in its row, each keeping its width')
})

test('duplicating a widget keeps settings its source can no longer read (Ratchet 29f73fd7)', () => {
  const { C, D, widget } = setup()
  D({ kind: 'updateWidget', widgetId: 'w1', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } })
  C('runs', { kind: 'removeProperty', propertyId: 'st' })
  D({ kind: 'duplicateWidget', widgetId: 'w1', newId: 'w2', newViewId: 'v2', newRowId: 'row2' })
  assert.equal(widget('w2')!.view.filter[0]?.by, 'st')
})

test('Duplicate view on a dashboard: a copy as stored, every id new, the original untouched', () => {
  const { h, C, add, dash } = setup()
  add('w2')
  const ids = { row1: 'R1', w1: 'W1', v1: 'V1', w2: 'W2', 'v-w2': 'V2' }
  C('home', { kind: 'duplicateDashboard', viewId: 'dash', newViewId: 'dash2', ids })
  const copy = h.page('home').database!.views.find(v => v.id === 'dash2')!
  assert.equal(copy.name, 'Dashboard (copy)')
  assert.equal(shape(copy.dashboard!), 'R1:W1/6,W2/6')
  assert.deepEqual(copy.dashboard!.rows[0]!.widgets.map(w => w.view.id), ['V1', 'V2'])
  assert.equal(shape(dash()), 'row1:w1/6,w2/6')
  assert.throws(() => C('home', { kind: 'duplicateDashboard', viewId: 'dash', newViewId: 'dash3', ids: { ...ids, w1: 'W2' } }), /Invalid id/, 'two old ids to one new one')
  assert.throws(() => C('home', { kind: 'duplicateDashboard', viewId: 'dash', newViewId: 'dash3', ids: { row1: 'X' } }), /Invalid id/, 'every id needs a new one')
})

test('a new dashboard counts against the views limit', () => {
  const { h, C, runs } = setup()
  const db = h.page('home').database!
  while (db.views.length < 50) db.views.push({ ...db.views[0]!, id: `pad${db.views.length}` })
  assert.throws(() => C('home', { kind: 'addDashboard', view: { id: 'dx', name: 'X' }, rows: [{ id: 'rx', widgets: [{ id: 'wx', source: 'runs', view: firstWidgetView(runs(), 'vx') }] }] }), /Too many views/)
  assert.throws(() => C('home', { kind: 'duplicateDashboard', viewId: 'dash', newViewId: 'dy', ids: { row1: 'a', w1: 'b', v1: 'c' } }), /Too many views/)
})
