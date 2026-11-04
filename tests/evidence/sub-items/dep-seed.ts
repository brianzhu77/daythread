// A disposable store for dependencies (R4-5): Plan, a chain of four rows with dates, `on` or not.
// Usage: node tests/evidence/sub-items/dep-seed.ts <store-path> [on]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/sub-items/dep-seed.ts <store-path> [on] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'plan', change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'plan', homeBlockId: null, title: 'Plan' })
await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
for (const [id, start] of [['a', '2026-03-02'], ['b', '2026-03-03'], ['c', '2026-03-04'], ['d', '2026-03-05']] as const) await run({ type: 'add-row', databaseId: 'plan', pageId: id, title: id, values: { when: start }, at })
if (process.argv[3] === 'on') {
  await change({ kind: 'setDependencies', on: { blockedBy: 'by', blocking: 'blocks', date: 'when', mode: 'overlap' } })
  for (const [id, by] of [['b', 'a'], ['c', 'b'], ['d', 'c']] as const) await run({ type: 'set-values', pageId: id, values: { by: [by] }, expected: {}, at })
}
console.log('seeded', process.argv[2])
