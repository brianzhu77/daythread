// A disposable store for Timeline (R4-1, R4-2): a Plans database with one row of each kind in timeline.md §3, around today, and a view by one Date.
// Usage: node tests/evidence/timeline/seed.ts <store-path>  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'plans', change: c })
const at = new Date().toISOString()
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
await run({ type: 'create-database', pageId: 'plans', homeBlockId: null, title: 'Plans' })
await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'from', name: 'From', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'to', name: 'To', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'made', name: 'Made', type: 'createdTime' } })
const add = (pageId: string, title: string, values: Record<string, unknown>) => run({ type: 'add-row', databaseId: 'plans', pageId, title, values: values as never, at })
await add('trip', 'Trip', { when: { start: day(1), end: day(5) }, from: { start: day(1) }, to: { start: day(5) } })
await add('call', 'Call', { when: { start: day(3) }, from: { start: day(3) } })
await add('ends', 'Ends only', { when: { start: day(4), end: day(4) }, to: { start: day(4) } })
await add('back', 'Backwards', { when: { start: day(-1) }, from: { start: day(2) }, to: { start: day(-1) } })
await add('old', 'Long ago', { when: { start: day(-40), end: day(-38) } })
await add('run', 'Running', { when: { start: day(-9), end: day(9) } })
await add('none', 'No dates yet', {})
const view = ws.pages.find(p => p.id === 'plans')!.database!.views[0]!
await change({ kind: 'updateView', viewId: view.id, layout: 'timeline', name: 'Timeline', dateBy: 'when' })
console.log('seeded')
