// Dependencies' arrows on a Timeline (R4-5): Plan, a chain and an overlap around today, a row with no date, and a row with a Kind for filtering and grouping.
// Usage: node tests/evidence/timeline/seed-arrows.ts <store-path> [off|group|filter]  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed-arrows.ts <store-path> [off|group|filter]'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: action as never })).workspace }
const at = new Date().toISOString()
const day = (from: number) => { const d = new Date(); d.setDate(d.getDate() + from); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
await run({ type: 'create-database', pageId: 'plan', homeBlockId: null, title: 'Plan' })
const change = (c: unknown) => run({ type: 'change-database', pageId: 'plan', change: c })
await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'work', name: 'Work' }, { id: 'home', name: 'Home' }] } })
const rows: [string, string, number | null, number | null, string][] = [
  ['design', 'Design', -6, -3, 'work'],
  ['build', 'Build', -1, 3, 'work'],
  ['ship', 'Ship', 5, 6, 'home'],
  ['clash', 'Starts too soon', -5, -2, 'home'],
  ['loose', 'On its own', 1, 4, 'home'],
  ['far', 'Far away', 300, 302, 'home'],
  ['none', 'No date yet', null, null, 'home'],
]
for (const [id, title, from, to, kind] of rows) await run({ type: 'add-row', databaseId: 'plan', pageId: id, title, values: { kind, ...(from !== null ? { when: { start: day(from), end: day(to!) } } : {}) }, at })
const view = ws.pages.find(p => p.id === 'plan')!.database!.views[0]!
await change({ kind: 'updateView', viewId: view.id, layout: 'timeline', dateBy: 'when' })
if (process.argv[3] !== 'off') {
  await change({ kind: 'setDependencies', on: { blockedBy: 'by', blocking: 'blocks', date: 'when', mode: 'overlap' } })
  for (const [id, by] of [['build', ['design']], ['ship', ['build']], ['clash', ['design']], ['far', ['ship']], ['none', ['ship']]] as const) await run({ type: 'set-values', pageId: id, values: { by: [...by] }, expected: {}, at })
}
if (process.argv[3] === 'group') await change({ kind: 'updateView', viewId: view.id, groupBy: 'kind' })
if (process.argv[3] === 'filter') await change({ kind: 'updateView', viewId: view.id, filter: [{ by: 'kind', op: 'isAnyOf', value: ['work'] }] })
console.log('seeded', process.argv[2])
