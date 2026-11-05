// A disposable store for type changes (R3-16): Shelf with Text, Date and Checkbox holding values, and a Select.
// Usage: node tests/evidence/type-conversions/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/type-conversions/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'shelf', change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'shelf', homeBlockId: null, title: 'Shelf' })
await change({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'text' } })
await change({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'text' } })
await change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'ok', name: 'Ok', type: 'checkbox' } })
await run({ type: 'add-row', databaseId: 'shelf', pageId: 'r1', title: 'One', values: { kind: 'Alpha', tags: 'red, green', due: { start: '2026-11-05' }, ok: true }, at })
await run({ type: 'add-row', databaseId: 'shelf', pageId: 'r2', title: 'Two', values: { kind: 'Beta', tags: 'green', due: { start: '2026-11-05', end: '2026-11-07' } }, at })
console.log('seeded', process.argv[2])
