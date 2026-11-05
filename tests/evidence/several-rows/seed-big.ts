import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
// A disposable store for a bar's All on a big view: Big, with a table and a board. Usage: node tests/evidence/several-rows/seed-big.ts <store-path> [rows]
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString(), count = Number(process.argv[3] ?? 250)
await run({ type: 'create-database', pageId: 'big', homeBlockId: null, title: 'Big' })
await run({ type: 'change-database', pageId: 'big', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
await run({ type: 'change-database', pageId: 'big', change: { kind: 'addProperty', property: { id: 's', name: 'Kind', type: 'select', options: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] } } })
await run({ type: 'add-rows', databaseId: 'big', rows: Array.from({ length: count }, (_, i) => ({ pageId: `r${i}`, title: `Row ${i}`, values: { n: i, s: i % 2 ? 'a' : 'b' } })), at })
await run({ type: 'change-database', pageId: 'big', change: { kind: 'addView', view: { id: 'bd', name: 'Board', layout: 'board', groupBy: 's', columns: [], sort: [], filter: [] } } as never })
console.log('seeded', count)
