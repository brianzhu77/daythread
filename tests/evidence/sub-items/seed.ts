// A disposable store for sub-items (R4-4): Work with rows; `on` turns sub-items on and nests some.
// `move` adds Archive, somewhere to move them to, and Nested, inside a sub-item.
// Usage: node tests/evidence/sub-items/seed.ts <store-path> [on|move]
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
if (process.argv[3] === 'on' || process.argv[3] === 'move') {
  await change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  for (const [id, parent] of [['kid', 'top'], ['grand', 'kid'], ['great', 'grand'], ['deep', 'great'], ['deeper', 'deep'], ['kid2', 'top']] as const) await run({ type: 'set-values', pageId: id, values: { par: [parent] }, expected: {}, at })
}
if (process.argv[3] === 'move') {
  await run({ type: 'create-database', pageId: 'archive', homeBlockId: null, title: 'Archive' })
  await run({ type: 'change-database', pageId: 'archive', change: { kind: 'addProperty', property: { id: 'nThere', name: 'N', type: 'number' } } })
  await run({ type: 'create-database', pageId: 'nested', parentId: 'kid', homeBlockId: null, title: 'Nested' })
}
if (process.argv[3] === 'grouped') {
  await change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  await change({ kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Now', color: 'gray' }, { id: 'b', name: 'Later', color: 'blue' }] } })
  await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
  // Top and its sub-item in different groups, and a row with no parent beside it.
  for (const [id, parent, st] of [['kid', 'top', 'b'], ['top', null, 'a'], ['other', null, 'b']] as const) await run({ type: 'set-values', pageId: id, values: { ...(parent ? { par: [parent] } : {}), st, when: new Date().toISOString().slice(0, 10) } })
  const base = ws.pages.find(p => p.id === 'work')!.database!.views[0]!
  for (const layout of ['list', 'board', 'gallery', 'timeline'] as const) await change({ kind: 'addView', view: { ...base, id: `v-${layout}`, name: layout, layout, groupBy: 'st', ...(layout === 'timeline' ? { dateBy: 'when', timelineTable: true } : {}), ...(layout === 'board' || layout === 'gallery' ? { subItemsDisplay: 'flat' } : {}) } as never })
  await change({ kind: 'updateView', viewId: base.id, groupBy: 'st' } as never)
}
console.log('seeded', process.argv[2])
