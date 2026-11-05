// A disposable store for automations (automations.md): Runs with rows, and with `rules`, a working rule, one with a deleted target and one switched off.
// Usage: node --no-warnings tests/evidence/automations/seed.ts <store-path> [rules]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { writeSteps } from '../../../src/domain/buttons.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/automations/seed.ts <store-path> [rules] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const C = (change: unknown) => run({ type: 'change-database', pageId: 'runs', change } as never)
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
await C({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
await C({ kind: 'addProperty', property: { id: 'gone', name: 'Soon gone', type: 'text' } })
await run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at } as never)
const set = (id: string, name: string, type: string, raw: unknown) => writeSteps([{ id: `s-${id}`, kind: 'edit-property', set: [{ id, name, type: type as never, value: { kind: 'fixed', raw: raw as never } }] }])
if (process.argv[3] === 'rules') {
  await C({ kind: 'addAutomation', automation: { id: 'works', name: 'Mark new', active: true, triggers: [{ kind: 'row-added' }], steps: set('n', 'N', 'number', 5) } })
  await C({ kind: 'addAutomation', automation: { id: 'broken', name: 'Uses a gone one', active: true, triggers: [{ kind: 'property-edited', propertyId: 'n', name: 'N' }], steps: set('gone', 'Soon gone', 'text', 'x') } })
  await C({ kind: 'addAutomation', automation: { id: 'off', name: 'Switched off', active: false, triggers: [{ kind: 'row-added' }], steps: set('n', 'N', 'number', 9) } })
  await C({ kind: 'removeProperty', propertyId: 'gone' })
}
console.log('seeded', process.argv[2])
