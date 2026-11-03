// A disposable store for relations (R3-5 to R3-7): Books with rows, Authors with rows, nothing linked yet.
// Usage: node tests/evidence/relations/seed.ts <store-path> [linked]  (`linked`: By, two-way, a rollup, and a few links)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/relations/seed.ts <store-path> [linked] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (pageId: string, c: DatabaseChange) => run({ type: 'change-database', pageId, change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
await run({ type: 'create-database', pageId: 'authors', homeBlockId: null, title: 'Authors' })
await change('authors', { kind: 'addProperty', property: { id: 'age', name: 'Age', type: 'number' } })
await run({ type: 'add-row', databaseId: 'authors', pageId: 'herbert', title: 'Herbert', values: { age: 65 }, at })
await run({ type: 'add-row', databaseId: 'authors', pageId: 'austen', title: 'Austen', values: { age: 41 }, at })
await run({ type: 'add-row', databaseId: 'books', pageId: 'dune', title: 'Dune', at })
await run({ type: 'add-row', databaseId: 'books', pageId: 'emma', title: 'Emma', at })
if (process.argv[3] === 'linked') {
  await change('books', { kind: 'addProperty', property: { id: 'by', name: 'By', type: 'relation', target: 'authors' } })
  await change('books', { kind: 'setMirror', propertyId: 'by', mirror: { id: 'wrote', name: 'Wrote' } })
  await change('books', { kind: 'addProperty', property: { id: 'ages', name: 'Ages', type: 'rollup', rollup: { relation: 'by', property: 'age', fn: 'sum' } } })
  await run({ type: 'set-values', pageId: 'dune', values: { by: ['herbert', 'austen'] }, expected: {}, at })
}
console.log('seeded')
