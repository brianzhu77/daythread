// G6-8 (dashboard.md §6): an older build keeps a dashboard. A store made by this build, with a split row, a row height,
// a widget filter and the reserved `dashboard.filter`, then edited by the floor build's own code: the dashboard view
// renamed and its filter edited, a source property renamed, and an unrelated page renamed. Read back by this build, the
// dashboard is byte for byte what it was.
// Usage: node --no-warnings tests/evidence/dashboard/floor.ts <store-path> <floor-checkout>  (e.g. a worktree at 9417eea2)
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { SqliteWorkspaceRepository as Now } from '../../../src/server/sqlite-repository.ts'
const [S, floor] = process.argv.slice(2)
if (!S || !floor) { console.error('Usage: node --no-warnings tests/evidence/dashboard/floor.ts <store-path> <floor-checkout>'); process.exit(2) }
execFileSync(process.execPath, ['--no-warnings', new URL('./seed.ts', import.meta.url).pathname, S], { stdio: 'ignore' })
const step = async (repo: any, action: any) => { const w = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (pageId: string, change: any) => ({ type: 'change-database', pageId, change })
let now: any = new Now(S, undefined, { allowMissingLegacy: true })
await step(now, C('home', { kind: 'sizeSplit', viewId: 'dash', rowId: 'row1', widgetIds: ['w-runs', 'w-books'], widths: [4, 8] }))
await step(now, C('home', { kind: 'sizeRow', viewId: 'dash', rowId: 'row1', height: 400 }))
await step(now, C('home', { kind: 'updateWidget', viewId: 'dash', widgetId: 'w-runs', fields: { filter: [{ by: 'st', op: 'isAnyOf', value: ['a'] }] } }))
// Step 3's field, reserved now (Lead 3e548c4e): nothing writes it yet, so it's put in the store directly.
{ const db = new DatabaseSync(S); const row: any = db.prepare('select data from workspace').get(); const data = JSON.parse(row.data); data.pages.find((p: any) => p.id === 'home').database.views.find((v: any) => v.id === 'dash').dashboard.filter = [{ by: 'st', op: 'isAnyOf', value: ['a'] }]; db.prepare('update workspace set data = ?').run(JSON.stringify(data)); db.close() }
now = new Now(S, undefined, { allowMissingLegacy: true })
const dashOf = (w: any) => w.pages.find((p: any) => p.id === 'home').database.views.find((v: any) => v.id === 'dash')
const before = dashOf(await now.load())
const { SqliteWorkspaceRepository: Old } = await import(`${floor}/src/server/sqlite-repository.ts`)
const old: any = new Old(S, undefined, { allowMissingLegacy: true })
const results: [boolean, string, string?][] = []
const ok = (name: string, pass: boolean, detail = '') => { results.push([pass, name, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const tried = async (name: string, action: any) => { try { await step(old, action); ok(`floor: ${name}`, true) } catch (e) { ok(`floor: ${name}`, false, (e as Error).message) } }
await tried('renames the dashboard view', C('home', { kind: 'updateView', viewId: 'dash', name: 'Renamed by the floor' }))
await tried("edits the dashboard view's own filter", C('home', { kind: 'updateView', viewId: 'dash', filter: [] }))
await tried('renames a widget\'s source property', C('runs', { kind: 'updateProperty', propertyId: 'st', name: 'Phase' }))
await tried('renames an unrelated page', { type: 'rename-page', pageId: 'books', title: 'Books (renamed)' })
const after = dashOf(await new Now(S, undefined, { allowMissingLegacy: true }).load())
ok('this build reads it back: still a dashboard, renamed', after.layout === 'dashboard' && after.name === 'Renamed by the floor', `${after.layout} ${after.name}`)
ok('rows, widths, heights and widget filters byte for byte', JSON.stringify(after.dashboard.rows) === JSON.stringify(before.dashboard.rows), JSON.stringify(after.dashboard.rows.map((r: any) => [r.height, r.widgets.map((w: any) => `${w.id}/${w.width}/${w.view.filter.length}`)])))
ok('the reserved dashboard.filter kept', JSON.stringify(after.dashboard.filter) === JSON.stringify(before.dashboard.filter))
console.log(`${results.filter(r => r[0]).length}/${results.length} passed`)
process.exit(results.every(r => r[0]) ? 0 : 1)
