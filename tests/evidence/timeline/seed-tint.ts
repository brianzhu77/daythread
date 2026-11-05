// On top of timeline/seed.ts: two colour rules on Plans, by Kind, and the undated row given a Kind (R4-12 on Timeline).
// Usage: node tests/evidence/timeline/seed-tint.ts <store-path>  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed-tint.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: action as never })).workspace }
await run({ type: 'set-values', pageId: 'none', values: { kind: 'work' }, expected: {}, at: new Date().toISOString() })
const view = ws.pages.find(p => p.id === 'plans')!.database!.views[0]!
await run({ type: 'change-database', pageId: 'plans', change: { kind: 'updateView', viewId: view.id, colourRules: [{ id: 'blue', tint: 'blue', rule: { by: 'kind', op: 'isAnyOf', value: ['work'] } }, { id: 'green', tint: 'green', rule: { by: 'kind', op: 'isAnyOf', value: ['home'] } }] } })
console.log('seeded', process.argv[2])
