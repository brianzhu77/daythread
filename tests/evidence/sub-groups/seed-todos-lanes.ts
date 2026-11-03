// To-dos on a board with lanes: the Board seed, plus a To-dos view on Books and to-dos planned on two days, each in one status.
// Usage: node tests/evidence/sub-groups/seed-todos-lanes.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/sub-groups/seed-todos-lanes.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
for (const [title, on] of [['Water the plants', dayOffset(1)], ['Call the bank', dayOffset(2)], ['Post the letter', dayOffset(3)]] as const) {
  await run({ type: 'ensure-day', date: on })
  await run({ type: 'add-task', pageId: ws.pages.find(p => p.date === on)!.id, title, plannedOn: on })
}
const view = { ...todosDatabase.views[0]!, id: 'todos-lanes', layout: 'board' as const, filter: [], groupBy: 'status', subGroupBy: 'planned', subGroupDateBy: 'day' as const }
const books = ws.pages.find(p => p.id === 'books')!
const block = { id: 'lanes', type: 'database', props: { pageId: todosSourceId, view: linkedViewJson(view, view.id) }, children: [] }
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(books), document: JSON.stringify([block]) })
console.log('seeded')
