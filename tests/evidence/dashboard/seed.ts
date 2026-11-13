// The store dashboard.mjs runs on: Runs and Books with rows, a to-do on today's page, and a Dashboard view on Home: Runs and
// Books in one row, To-dos and a second view of Runs in another. A page "Notes" holds a block of Home turned to the dashboard.
// Usage: node --no-warnings tests/evidence/dashboard/seed.ts <store-path>  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { firstWidgetView } from '../../../src/domain/dashboard.ts'
import { todosSourceId } from '../../../src/domain/todos-id.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { todosDatabase } from '../../../src/domain/todos-source.ts'
const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/dashboard/seed.ts <store-path>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (pageId: string, change: any) => run({ type: 'change-database', pageId, change })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
await C('runs', { kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }, { id: 'b', name: 'Done', color: 'gray' }] } })
for (const [id, title, st] of [['r1', 'Alpha', 'a'], ['r2', 'Bravo', 'b'], ['r3', 'Charlie', 'a']]) await run({ type: 'add-row', databaseId: 'runs', pageId: id, title, values: { st }, at })
await run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
for (const [id, title] of [['b1', 'Dune'], ['b2', 'Emma']]) await run({ type: 'add-row', databaseId: 'books', pageId: id, title, at })
// More of them, so Books is taller than 360 px at 390 and shows Show more there.
for (let n = 3; n <= 14; n++) await run({ type: 'add-row', databaseId: 'books', pageId: `b${n}`, title: `Book ${n}`, at })
await run({ type: 'create-database', pageId: 'home', homeBlockId: null, title: 'Home' })
const db = (id: string) => w.pages.find((p: any) => p.id === id).database
await C('home', { kind: 'addDashboard', view: { id: 'dash', name: 'This week' }, rows: [{ id: 'row1', widgets: [
  { id: 'w-runs', source: 'runs', view: { ...firstWidgetView(db('runs'), 'v-runs'), name: 'Table' } },
  { id: 'w-books', source: 'books', view: { ...firstWidgetView(db('books'), 'v-books'), name: 'Table' } },
] }, { id: 'row2', widgets: [
  { id: 'w-todos', source: todosSourceId, view: { ...firstWidgetView(todosDatabase, 'v-todos'), name: 'Open' } },
  { id: 'w-runs2', source: 'runs', view: { ...firstWidgetView(db('runs'), 'v-runs2'), name: 'By stage' } },
] }] })
// Shown first on Home's page, as a fresh dashboard is (the views panel turns to it).
const home = w.pages.find((p: any) => p.id === 'home').database
await C('home', { kind: 'moveView', viewId: 'dash', beforeId: home.views[0].id })
// Wall: a dashboard of four quarter widgets in one row, for wrapping with the Comments pane open.
await run({ type: 'create-database', pageId: 'wall', homeBlockId: null, title: 'Wall' })
// Wide: eight columns, wider than a phone, for a widget that scrolls sideways inside itself.
await run({ type: 'create-database', pageId: 'wide', homeBlockId: null, title: 'Wide' })
for (let n = 1; n <= 8; n++) await C('wide', { kind: 'addProperty', property: { id: `c${n}`, name: `Column ${n}`, type: 'text' } })
await run({ type: 'add-row', databaseId: 'wide', pageId: 'wr1', title: 'A wide row', values: { c1: 'one', c8: 'eight' }, at })
const quarterOf = (i: number) => (i === 3 ? 'wide' : i % 2 ? 'books' : 'runs')
await C('wall', { kind: 'addDashboard', view: { id: 'quad', name: 'Four quarters of a dashboard with a very long name indeed' }, rows: [{ id: 'q', widgets: ['a', 'b', 'c', 'd'].map((x, i) => ({ id: `q${x}`, width: 3, source: quarterOf(i), view: { ...firstWidgetView(db(quarterOf(i)), `qv${x}`), name: `Quarter ${x}` } })) }] })
await C('wall', { kind: 'moveView', viewId: 'quad', beforeId: w.pages.find((p: any) => p.id === 'wall').database.views[0].id })
// Shelf: Books and Runs in a row, and under them a widget whose database has since gone for good (as Trash's sweep leaves it).
await run({ type: 'create-database', pageId: 'temp', homeBlockId: null, title: 'Temp' })
await run({ type: 'create-database', pageId: 'shelf', homeBlockId: null, title: 'Shelf' })
await C('shelf', { kind: 'addDashboard', view: { id: 'shelfdash', name: 'Shelf board' }, rows: [
  { id: 's1', widgets: [{ id: 's-books', source: 'books', view: firstWidgetView(db('books'), 'sv-books') }, { id: 's-runs', source: 'runs', view: firstWidgetView(db('runs'), 'sv-runs') }] },
  { id: 's2', widgets: [{ id: 's-gone', source: 'temp', view: firstWidgetView(db('temp'), 'sv-gone') }] },
] })
await C('shelf', { kind: 'moveView', viewId: 'shelfdash', beforeId: w.pages.find((p: any) => p.id === 'shelf').database.views[0].id })
// A to-do planned for today, for the To-dos widget's tick.
const today = new Date().toLocaleDateString('en-CA')
await run({ type: 'ensure-day', date: today })
const day = w.pages.find((p: any) => p.type === 'daily' && p.date === today)
await run({ type: 'add-task', pageId: day.id, title: 'Water the plants', plannedOn: today })
// A document holding a block of Home whose view is the dashboard: anywhere but Home's own page it's a link.
await run({ type: 'create-document', title: 'Notes', body: 'Above the block', pageId: 'notes' })
const notes = w.pages.find((p: any) => p.id === 'notes')
const dash = w.pages.find((p: any) => p.id === 'home').database.views.find((v: any) => v.id === 'dash')
const doc = JSON.parse(notes.document)
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(notes), document: JSON.stringify([...doc, { id: 'home-block', type: 'database', props: { pageId: 'home', view: JSON.stringify({ ...dash, id: 'linked-dash' }) }, children: [] }]), today })
// Temp gone for good: out of the store, as the sweep takes a page from Trash after its time.
{ const sql = new DatabaseSync(S); const row: any = sql.prepare('select data from workspace').get(); const data = JSON.parse(row.data); data.pages = data.pages.filter((p: any) => p.id !== 'temp'); sql.prepare('update workspace set data = ?').run(JSON.stringify(data)); sql.close() }
console.log('views', w.pages.find((p: any) => p.id === 'home').database.views.map((v: any) => `${v.id}:${v.layout}`).join(','), todosSourceId)
