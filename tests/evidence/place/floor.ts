// G8-8: an older build keeps Place values. A store made by this build (seed.ts), then edited by the floor build's own
// code: an unrelated page write, another property of the same row, the view, a type round trip on another property, a
// reload; and the floor turning Place itself into Text with a row edit, which this build turns back (Bumblebee
// ccef53c3). Read back by this build, every Place value is byte for byte what it was.
// Usage: node --no-warnings tests/evidence/place/floor.ts <store-path> <floor-checkout>  (e.g. a worktree at 4dcde91a)
import { execFileSync } from 'node:child_process'
import { SqliteWorkspaceRepository as Now } from '../../../src/server/sqlite-repository.ts'
import { readValue } from '../../../src/domain/database.ts'
const [S, floor] = process.argv.slice(2)
if (!S || !floor) { console.error('Usage: node --no-warnings tests/evidence/place/floor.ts <store-path> <floor-checkout>'); process.exit(2) }
execFileSync(process.execPath, ['--no-warnings', new URL('./seed.ts', import.meta.url).pathname, S], { stdio: 'ignore' })
const step = async (repo: any, action: any) => { const w = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (change: any) => ({ type: 'change-database', pageId: 'eats', change })
const at = '2026-11-14T10:00:00.000Z'
const rows = ['e1', 'e2', 'e3', 'e4']
const placesOf = (w: any) => Object.fromEntries(rows.map(id => [id, JSON.stringify(w.pages.find((p: any) => p.id === id)?.values?.pl ?? null)]))
const now = () => new Now(S, undefined, { allowMissingLegacy: true })
const before = placesOf(await now().load())
const { SqliteWorkspaceRepository: Old } = await import(`${floor}/src/server/sqlite-repository.ts`)
let old: any = new Old(S, undefined, { allowMissingLegacy: true })
const results: [boolean, string, string?][] = []
const ok = (name: string, pass: boolean, detail = '') => { results.push([pass, name, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const tried = async (name: string, action: any) => { try { await step(old, action); ok(`floor: ${name}`, true) } catch (e) { ok(`floor: ${name}`, false, (e as Error).message) } }
const same = async (name: string) => { const after = placesOf(await now().load()); ok(name, JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after)) }

await tried('writes an unrelated page', { type: 'create-document', title: 'Elsewhere', body: 'a line', pageId: 'elsewhere' })
await tried('edits another property of a row holding a place', { type: 'set-values', pageId: 'e1', values: { nt: 'by the floor' }, expected: {}, at })
const view = (await old.load()).pages.find((p: any) => p.id === 'eats').database.views[0]
await tried('edits the view', C({ kind: 'updateView', viewId: view.id, name: 'Renamed by the floor' }))
await tried('changes another property to Number', C({ kind: 'updateProperty', propertyId: 'nt', type: 'number' }))
await tried('and back to Text', C({ kind: 'updateProperty', propertyId: 'nt', type: 'text' }))
old = new Old(S, undefined, { allowMissingLegacy: true })
await tried('after a reload, writes again', { type: 'rename-page', pageId: 'elsewhere', title: 'Elsewhere, renamed' })
await same('this build reads every Place value back byte for byte')

// The floor turns Place itself into Text and saves a row edit; this build turns it back to Place.
await tried('turns the Place property into Text', C({ kind: 'updateProperty', propertyId: 'pl', type: 'text' }))
await tried('saves a row edit there', { type: 'set-values', pageId: 'e2', values: { nt: 'edited while Text' }, expected: {}, at })
await same('while Text, the stored places are untouched')
try { await step(now(), C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })); ok('this build turns it back to Place', true) } catch (e) { ok('this build turns it back to Place', false, (e as Error).message) }
await same('and every value reads back byte for byte')
{
  const w = await now().load(), db = w.pages.find((p: any) => p.id === 'eats').database, prop = db.properties.find((p: any) => p.id === 'pl')
  const read = rows.map(id => readValue(prop, w.pages.find((p: any) => p.id === id).values?.pl))
  ok('and reads as places again: the pin, the words, the empties', prop.type === 'place' && (read[0] as any)?.lat === 49.1859 && (read[1] as any)?.name === 'ramen place near work' && read[2] === null && read[3] === null, JSON.stringify(read))
}
console.log(`${results.filter(r => r[0]).length}/${results.length} passed`)
process.exit(results.every(r => r[0]) ? 0 : 1)
