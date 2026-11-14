// The store map.mjs runs on: "Eats" with a Place property and a Map view first (12 pins around Vancouver, 2 rows with
// no place); "Many" with 240 pins, for the cap and clusters; "Notes", a page holding Eats inline; and "Board", a
// dashboard of three Map widgets, for one live map at a time.
// Usage: node --no-warnings tests/evidence/map/seed.ts <store-path> [pins-in-Many]  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
const [S, manyArg] = process.argv.slice(2)
if (!S) { console.error('Usage: node --no-warnings tests/evidence/map/seed.ts <store-path> [pins-in-Many]'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (pageId: string, change: any) => run({ type: 'change-database', pageId, change })
const at = new Date().toISOString()
await run({ type: 'set-timezone', timezone: 'America/Vancouver' }).catch(() => {})
await run({ type: 'create-database', pageId: 'eats', homeBlockId: null, title: 'Eats' })
await C('eats', { kind: 'addProperty', property: { id: 'pl', name: 'Where', type: 'place' } })
await C('eats', { kind: 'addProperty', property: { id: 'nt', name: 'Notes', type: 'text' } })
const spots: [string, number, number][] = [['Golden Dumpling', 49.1859, -123.1338], ['Ramen Danbo', 49.2634, -123.1385], ['Stanley Park', 49.3017, -123.1417], ['Granville Island', 49.2712, -123.1340], ['Gastown', 49.2840, -123.1089], ['Kits Beach', 49.2733, -123.1550], ['Main St', 49.2620, -123.1010], ['UBC', 49.2606, -123.2460], ['Commercial Dr', 49.2700, -123.0690], ['Chinatown', 49.2797, -123.1003], ['Yaletown', 49.2755, -123.1219], ['Olympic Village', 49.2710, -123.1060]]
let n = 0
for (const [name, lat, lon] of spots) await run({ type: 'add-row', databaseId: 'eats', pageId: `e${++n}`, title: name, values: { pl: { name, lat, lon, ref: `osm:N${n}` }, nt: `note ${n}` }, at })
// Two rows at one address: at the deepest zoom they open one card listing both.
for (const [id, title] of [['twin-a', 'Twin A'], ['twin-b', 'Twin B']]) await run({ type: 'add-row', databaseId: 'eats', pageId: id, title, values: { pl: { name: 'Shared Hall', lat: 49.2500, lon: -123.1000 } }, at })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e-words', title: 'Someday', values: { pl: { name: 'that place near work' } }, at })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e-none', title: 'Unplaced', values: {}, at })
await C('eats', { kind: 'addView', view: { id: 'eats-map', name: 'Map', layout: 'map', mapBy: 'pl', columns: [{ id: 'nt' }], sort: [], filter: [] } })
await C('eats', { kind: 'moveView', viewId: 'eats-map', beforeId: w.pages.find((p: any) => p.id === 'eats').database.views[0].id })
// A filtered map: Notes containing "note 1" leaves e1, e10, e11 and e12, all pinned, and nothing without a place.
await C('eats', { kind: 'addView', view: { id: 'filtered', name: 'Filtered map', layout: 'map', mapBy: 'pl', columns: [], sort: [], filter: [{ by: 'nt', op: 'contains', value: 'note 1' }] } })
// A view whose Place property has gone: "Choose a Place property".
await C('eats', { kind: 'addProperty', property: { id: 'gone', name: 'Old place', type: 'place' } })
await C('eats', { kind: 'addView', view: { id: 'orphan', name: 'Old map', layout: 'map', mapBy: 'gone', columns: [], sort: [], filter: [] } })
await C('eats', { kind: 'removeProperty', propertyId: 'gone' })
// Many: a grid of pins over the city, past the cap.
const many = Number(manyArg ?? 240)
await run({ type: 'create-database', pageId: 'many', homeBlockId: null, title: 'Many' })
await C('many', { kind: 'addProperty', property: { id: 'pl', name: 'Where', type: 'place' } })
for (let i = 0; i < many; i++) await run({ type: 'add-row', databaseId: 'many', pageId: `m${i}`, title: `Spot ${i}`, values: { pl: { name: `Spot ${i}`, lat: 49.2 + (i % 20) * 0.006, lon: -123.2 + Math.floor(i / 20) * 0.01 } }, at })
await C('many', { kind: 'addView', view: { id: 'many-map', name: 'Map', layout: 'map', mapBy: 'pl', columns: [], sort: [], filter: [] } })
await C('many', { kind: 'moveView', viewId: 'many-map', beforeId: w.pages.find((p: any) => p.id === 'many').database.views[0].id })
// Notes: Eats inline, its block showing the Map view.
await run({ type: 'create-document', title: 'Notes', body: 'Above the map', pageId: 'notes' })
const eatsMap = w.pages.find((p: any) => p.id === 'eats').database.views.find((v: any) => v.id === 'eats-map')
const notes = w.pages.find((p: any) => p.id === 'notes')
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(notes), document: JSON.stringify([...JSON.parse(notes.document), { id: 'eats-block', type: 'database', props: { pageId: 'eats', view: JSON.stringify({ ...eatsMap, id: 'linked-map' }) }, children: [] }]) })
// Board: three Map widgets on one dashboard.
await run({ type: 'create-database', pageId: 'board', homeBlockId: null, title: 'Board' })
const widget = (id: string, source: string, view: any) => ({ id, source, view: { ...view, id: `v-${id}` } })
await C('board', { kind: 'addDashboard', view: { id: 'dash', name: 'Maps' }, rows: [{ id: 'r1', widgets: [widget('w1', 'eats', eatsMap), widget('w2', 'many', w.pages.find((p: any) => p.id === 'many').database.views.find((v: any) => v.id === 'many-map'))] }, { id: 'r2', widgets: [widget('w3', 'eats', eatsMap)] }] })
await C('board', { kind: 'moveView', viewId: 'dash', beforeId: w.pages.find((p: any) => p.id === 'board').database.views[0].id })
// Plain: a database with no Place property yet, for "+ New Place property".
await run({ type: 'create-database', pageId: 'plain', homeBlockId: null, title: 'Plain' })
for (const [id, title] of [['p1', 'First'], ['p2', 'Second']]) await run({ type: 'add-row', databaseId: 'plain', pageId: id, title, at })
await run({ type: 'ensure-day', date: new Date().toLocaleDateString('en-CA') })
console.log('seeded', w.revision)
