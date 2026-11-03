// More property types: the Board seed plus one row from months ago, so grouping by Created time has two groups.
// Usage: node tests/evidence/more-types/seed-types.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/more-types/seed-types.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'add-row', databaseId: 'list', pageId: 'old', title: 'From January', at: '2026-01-15T10:00:00.000Z' })
// A second database holding only these types, as a List, which draws just its first three.
await run({ type: 'create-database', pageId: 'people', homeBlockId: null, title: 'People' })
for (const [id, name, type] of [['mail', 'Mail', 'email'], ['tel', 'Tel', 'phone'], ['num', 'No.', 'id'], ['made', 'Made', 'createdTime']] as const) await run({ type: 'change-database', pageId: 'people', change: { kind: 'addProperty', property: { id, name, type } } })
await run({ type: 'add-row', databaseId: 'people', pageId: 'ann', title: 'Ann', values: { mail: 'ann@example.com', tel: '+1 415 555 0100' }, at: new Date().toISOString() })
const viewId = ws.pages.find(p => p.id === 'people')!.database!.views[0]!.id
await run({ type: 'change-database', pageId: 'people', change: { kind: 'updateView', viewId, layout: 'list', name: 'List', columns: [{ id: 'mail' }, { id: 'tel' }, { id: 'num' }, { id: 'made' }] } })
console.log('seeded')
