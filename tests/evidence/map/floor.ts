// G8-12: an older build keeps `layout: map`. A store made by this build (seed.ts), then edited by the floor build's own
// code: the Map view renamed and its filter edited, a row edited, another page written, a reload; and its layout asked to
// change, which is recorded, not promised. Read back by this build, the view is still a map by its Place property.
// Usage: node --no-warnings tests/evidence/map/floor.ts <store-path> <floor-checkout>  (e.g. a worktree at 4dcde91a)
import { execFileSync } from 'node:child_process'
import { SqliteWorkspaceRepository as Now } from '../../../src/server/sqlite-repository.ts'
const [S, floor] = process.argv.slice(2)
if (!S || !floor) { console.error('Usage: node --no-warnings tests/evidence/map/floor.ts <store-path> <floor-checkout>'); process.exit(2) }
execFileSync(process.execPath, ['--no-warnings', new URL('./seed.ts', import.meta.url).pathname, S, '20'], { stdio: 'ignore' })
const step = async (repo: any, action: any) => { const w = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (change: any) => ({ type: 'change-database', pageId: 'eats', change })
const mapOf = (w: any) => w.pages.find((p: any) => p.id === 'eats').database.views.find((v: any) => v.id === 'eats-map')
const placesOf = (w: any) => JSON.stringify(w.pages.filter((p: any) => p.parentId === 'eats').map((p: any) => [p.id, p.values?.pl ?? null]))
const now = () => new Now(S, undefined, { allowMissingLegacy: true })
const w0 = await now().load(), before = mapOf(w0), places0 = placesOf(w0)
const { SqliteWorkspaceRepository: Old } = await import(`${floor}/src/server/sqlite-repository.ts`)
let old: any = new Old(S, undefined, { allowMissingLegacy: true })
const results: [boolean, string, string?][] = []
const ok = (name: string, pass: boolean, detail = '') => { results.push([pass, name, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const tried = async (name: string, action: any) => { try { await step(old, action); ok(`floor: ${name}`, true) } catch (e) { ok(`floor: ${name}`, false, (e as Error).message) } }
await tried('renames the Map view', C({ kind: 'updateView', viewId: 'eats-map', name: 'Places, renamed by the floor' }))
await tried("edits the Map view's filter", C({ kind: 'updateView', viewId: 'eats-map', filter: [{ by: 'nt', op: 'contains', value: 'note' }] }))
await tried('edits a row', { type: 'set-values', pageId: 'e1', values: { nt: 'by the floor' }, expected: {}, at: '2026-11-14T10:00:00.000Z' })
await tried('writes another page', { type: 'create-document', title: 'Elsewhere', body: 'a line', pageId: 'elsewhere' })
old = new Old(S, undefined, { allowMissingLegacy: true })
await tried('after a reload, writes again', { type: 'rename-page', pageId: 'elsewhere', title: 'Elsewhere, renamed' })
{
  const after = mapOf(await now().load())
  const { name: _n, filter: _f, ...rest } = after, { name: _n0, filter: _f0, ...rest0 } = before
  ok('this build reads it back: still a map by its Place, renamed, filter kept, the rest byte for byte', after.layout === 'map' && after.mapBy === 'pl' && after.name === 'Places, renamed by the floor' && after.filter.length === 1 && JSON.stringify(rest) === JSON.stringify(rest0), `${after.layout} ${after.mapBy} ${after.name}`)
  ok('every Place value byte for byte', placesOf(await now().load()) === places0)
}
// Recorded, not promised: the floor asked to change the map's own layout.
try { await step(old, C({ kind: 'updateView', viewId: 'eats-map', layout: 'table' })); const v = mapOf(await now().load()); console.log(`RECORD floor: changing the map's layout to table was taken; now ${v.layout}, mapBy ${v.mapBy ?? 'gone'}`) }
catch (e) { console.log(`RECORD floor: changing the map's layout was refused: ${(e as Error).message}`) }
console.log(`${results.filter(r => r[0]).length}/${results.length} passed`)
process.exit(results.every(r => r[0]) ? 0 : 1)
