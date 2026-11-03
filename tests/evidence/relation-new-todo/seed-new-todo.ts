// A relation to To-dos: the Board seed plus a Jobs property, and one to-do already on today's page to pick.
// Usage: node tests/evidence/relation-new-todo/seed-new-todo.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { todosSourceId } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/relation-new-todo/seed-new-todo.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'jobs', name: 'Jobs', type: 'relation', target: todosSourceId } } })
const view = ws.pages.find(p => p.id === 'list')!.database!.views[0]!
await run({ type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: view.id, columns: [{ id: 'jobs' }, ...view.columns.filter(c => c.id !== 'jobs')] } })
const today = new Date().toLocaleDateString('en-CA')
await run({ type: 'ensure-day', date: today })
await run({ type: 'add-task', pageId: ws.pages.find(p => p.date === today)!.id, title: 'Already here', plannedOn: today })
console.log('seeded')
