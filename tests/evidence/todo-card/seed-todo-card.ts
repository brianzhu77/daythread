// A page with a To-dos view, and a To-do with a long title; the Board seed too, for a long title on an ordinary card.
// Usage: node tests/evidence/todo-card/seed-todo-card.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/todo-card/seed-todo-card.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath} board`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'rename-page', pageId: 'emma', title: 'Emma, with a title long enough that it can never fit on one line of a card' })
const today = new Date().toLocaleDateString('en-CA')
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.date === today)!
for (const t of ['Book the flights', 'A to-do with a title long enough to run on past the width of a card']) await run({ type: 'add-task', pageId: day.id, title: t, plannedOn: today })
await run({ type: 'create-document', title: 'Todos', body: '', pageId: 'todos' })
await run({ type: 'save-editor', pageId: 'todos', expectedContent: pageContentKey(ws.pages.find(x => x.id === 'todos')!), document: JSON.stringify([{ id: 'b1', type: 'database', props: { pageId: 'source:tasks', view: '' }, children: [] }]) })
console.log('seeded')
