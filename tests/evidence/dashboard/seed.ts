// The store dashboard.mjs runs on: Runs and Books with rows, a to-do on today's page, and a Dashboard view on Home: Runs and
// Books in one row, To-dos and a second view of Runs in another. A page "Notes" holds a block of Home turned to the dashboard.
// Usage: node --no-warnings tests/evidence/dashboard/seed.ts <store-path>  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
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
await C('wall', { kind: 'addDashboard', view: { id: 'quad', name: 'Four' }, rows: [{ id: 'q', widgets: ['a', 'b', 'c', 'd'].map((x, i) => ({ id: `q${x}`, width: 3, source: i % 2 ? 'books' : 'runs', view: { ...firstWidgetView(db(i % 2 ? 'books' : 'runs'), `qv${x}`), name: `Quarter ${x}` } })) }] })
await C('wall', { kind: 'moveView', viewId: 'quad', beforeId: w.pages.find((p: any) => p.id === 'wall').database.views[0].id })
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
console.log('views', w.pages.find((p: any) => p.id === 'home').database.views.map((v: any) => `${v.id}:${v.layout}`).join(','), todosSourceId)
