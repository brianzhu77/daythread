// Calendar by a created or edited time: the Board seed, Created and Edited time and ID, and one row from January.
// Usage: node tests/evidence/calendar-by-time/seed-calendar-time.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/calendar-by-time/seed-calendar-time.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'add-row', databaseId: 'list', pageId: 'old', title: 'From January', at: '2026-01-15T18:00:00.000Z' })
for (const [id, name, type] of [['made', 'Made', 'createdTime'], ['seen', 'Changed', 'editedTime'], ['num', 'No.', 'id']] as const) await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id, name, type } } })
// A row from before Created time was kept: no command can make one, so the store is edited here.
await run({ type: 'add-row', databaseId: 'list', pageId: 'legacy', title: 'From before', at: '2026-01-15T18:00:00.000Z' })
const file = new DatabaseSync(storePath)
const data = JSON.parse((file.prepare('select data from workspace').get() as { data: string }).data)
const legacy = data.pages.find((p: { id: string }) => p.id === 'legacy')
delete legacy.createdAt
delete legacy.editedAt
file.prepare('update workspace set data = ?').run(JSON.stringify(data))
file.close()
console.log('seeded')
