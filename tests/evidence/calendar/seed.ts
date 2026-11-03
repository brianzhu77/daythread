// Calendar: a disposable SQLite store (path as the argument, never his data) with board/seed-board.ts's database, and on the given day 5 rows, a range and a timed row.
// Usage: node tests/evidence/calendar/seed.ts <store-path> <today> [first]
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, today, first] = process.argv.slice(2)
if (!storePath || !today) { console.error('Usage: node tests/evidence/calendar/seed.ts <store-path> <today> [first]'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
const shift = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
for (let i = 1; i <= 5; i++) await run({ type: 'add-row', databaseId: 'list', pageId: `today${i}`, title: `Today ${i}`, values: { due: { start: today } } as never, at })
await run({ type: 'add-row', databaseId: 'list', pageId: 'range', title: 'A range', values: { due: { start: shift(1), end: shift(3) } } as never, at })
await run({ type: 'add-row', databaseId: 'list', pageId: 'timed', title: 'At 9:30', values: { due: { start: `${shift(1)}T09:30` } } as never, at })
if (first === 'first') {
  const viewId = ws.pages.find(p => p.id === 'list')!.database!.views[0]!.id
  await run({ type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId, layout: 'calendar', name: 'Calendar', dateBy: 'due', columns: [] } })
}
console.log('seeded')
