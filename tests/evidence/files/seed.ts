// A disposable store for Files (R3-11): Shelf with a Files property, a row, and a Gallery view.
// Usage: node tests/evidence/files/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/files/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'shelf', change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'shelf', homeBlockId: null, title: 'Shelf' })
await change({ kind: 'addProperty', property: { id: 'att', name: 'Attachments', type: 'files' } })
for (const [id, title] of [['one', 'First row'], ['two', 'Second row']] as const) await run({ type: 'add-row', databaseId: 'shelf', pageId: id, title, at })
const table = ws.pages.find(p => p.id === 'shelf')!.database!.views[0]!
void table
await change({ kind: 'addView', view: { id: 'cards', name: 'Cards', layout: 'gallery', columns: [], sort: [], filter: [] } } as never)
console.log('seeded', process.argv[2])
