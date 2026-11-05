// A disposable store for a Formula date on a Calendar and a Timeline (R4-14 audit, 7): Plan, whose only date is a Formula of today plus each row's N days.
// `rollup`: its only date is a Rollup with `latest`, through a relation.
// Usage: node tests/evidence/formula-dates/seed.ts <store-path> [rollup]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/formula-dates/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'plan', homeBlockId: null, title: 'Plan' })
await run({ type: 'change-database', pageId: 'plan', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
await run({ type: 'change-database', pageId: 'plan', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'formula', formula: 'dateAdd(today(), prop("n"), "days")' } } })
for (const [id, title, n] of [['a', 'Today row', 0], ['b', 'Tomorrow row', 1]] as const) await run({ type: 'add-row', databaseId: 'plan', pageId: id, title, values: { n }, at })
if (process.argv[3] === 'rollup') {
  await run({ type: 'create-database', pageId: 'source', homeBlockId: null, title: 'Source' })
  await run({ type: 'change-database', pageId: 'source', change: { kind: 'addProperty', property: { id: 'on', name: 'On', type: 'date' } } })
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  await run({ type: 'add-row', databaseId: 'source', pageId: 's1', title: 'S1', values: { on: { start: soon } }, at })
  await run({ type: 'change-database', pageId: 'plan', change: { kind: 'removeProperty', propertyId: 'when' } })
  await run({ type: 'change-database', pageId: 'plan', change: { kind: 'addProperty', property: { id: 'link', name: 'Link', type: 'relation', target: 'source' } } })
  await run({ type: 'change-database', pageId: 'plan', change: { kind: 'addProperty', property: { id: 'roll', name: 'Latest', type: 'rollup', rollup: { relation: 'link', property: 'on', fn: 'latest' } } } })
  await run({ type: 'set-values', pageId: 'a', values: { link: ['s1'] }, expected: {}, at })
}
console.log('seeded', process.argv[2])
