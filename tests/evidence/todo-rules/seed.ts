// A disposable store for To-dos' rules (automations.md §7): today's page with three to-dos, a Log database, and Lists, a page with a To-dos view.
// Usage: node --no-warnings tests/evidence/todo-rules/seed.ts <store-path> <today>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/todo-rules/seed.ts <store-path> <today> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, title: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
const para = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify([line('a', 'Alpha'), line('b', 'Bravo'), line('c', 'Charlie'), para('p', 'Last line')]), today })
await run({ type: 'create-document', title: 'Lists', body: '', pageId: 'lists' })
await run({ type: 'save-editor', pageId: 'lists', expectedContent: pageContentKey(ws.pages.find(x => x.id === 'lists')!), document: JSON.stringify([{ id: 'todos', type: 'database', props: { pageId: 'source:tasks', view: '' }, children: [] }]), today })
console.log('seeded', path)
