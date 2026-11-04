// A disposable store for sub-items (R4-4): Work with rows; `on` turns sub-items on and nests some.
// Usage: node tests/evidence/sub-items/seed.ts <store-path> [on]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/sub-items/seed.ts <store-path> [on] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'work', change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'work', homeBlockId: null, title: 'Work' })
await change({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
for (const [id, n] of [['top', 1], ['kid', 2], ['grand', 3], ['great', 4], ['deep', 5], ['deeper', 6], ['kid2', 7], ['other', 8]] as const) await run({ type: 'add-row', databaseId: 'work', pageId: id, title: id, values: { n }, at })
if (process.argv[3] === 'on') {
  await change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  for (const [id, parent] of [['kid', 'top'], ['grand', 'kid'], ['great', 'grand'], ['deep', 'great'], ['deeper', 'deep'], ['kid2', 'top']] as const) await run({ type: 'set-values', pageId: id, values: { par: [parent] }, expected: {}, at })
}
console.log('seeded', process.argv[2])
