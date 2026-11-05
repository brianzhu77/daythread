// A Timeline whose table has more columns than fit (R4-1): Plan, with seven text properties and a calculation, three rows around today.
// Usage: node tests/evidence/timeline/seed-pane.ts <store-path> [sorted]  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed-pane.ts <store-path> [sorted]'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: action as never })).workspace }
const at = new Date().toISOString()
const day = (from: number) => { const d = new Date(); d.setDate(d.getDate() + from); return d.toLocaleDateString('en-CA') }
await run({ type: 'create-database', pageId: 'plan', homeBlockId: null, title: 'Plan' })
const change = (c: unknown) => run({ type: 'change-database', pageId: 'plan', change: c })
await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
const extra = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']
for (const id of extra) await change({ kind: 'addProperty', property: { id, name: `Col ${id}`, type: 'text' } })
for (const [id, title, from] of [['a', 'Alpha', -2], ['b', 'Beta', 1], ['c', 'Gamma', 4]] as const) await run({ type: 'add-row', databaseId: 'plan', pageId: id, title, values: { when: { start: day(from), end: day(from + 2) }, ...Object.fromEntries(extra.map(x => [x, `${title} ${x}`])) }, at })
await run({ type: 'add-row', databaseId: 'plan', pageId: 'far', title: 'Far', values: { when: { start: day(200), end: day(201) } }, at })
const view = ws.pages.find(p => p.id === 'plan')!.database!.views[0]!
await change({ kind: 'updateView', viewId: view.id, layout: 'timeline', dateBy: 'when', columns: extra.map(id => ({ id })), ...(process.argv[3] === 'sorted' ? { sort: [{ by: 'one', direction: 'asc' }] } : {}) })
console.log('seeded', process.argv[2])
