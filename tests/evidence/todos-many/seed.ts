// A disposable store for several to-dos (R4-17): a day's to-dos in every state, on a page's To-dos view, and `many` for past the limit.
// Usage: node tests/evidence/todos-many/seed.ts <store-path> [many]  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/todos-many/seed.ts <store-path> [many]'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const today = new Date().toLocaleDateString('en-CA')
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.date === today)!
const titles = process.argv[3] === 'many' ? Array.from({ length: 505 }, (_, i) => `To-do ${i + 1}`) : ['Book the flights', 'Water the plants', 'Call the bank', 'Pay the rent', 'Read the lease', 'Paused one', 'Cancelled one']
for (const title of titles) await run({ type: 'add-task', pageId: day.id, title, plannedOn: today })
const id = (title: string) => ws.tasks.find(t => t.title === title)?.id
if (id('Paused one')) await run({ type: 'not-today', taskId: id('Paused one')!, date: today })
if (id('Cancelled one')) await run({ type: 'edit-todos', items: [{ taskId: id('Cancelled one')!, changes: [{ columnId: 'status', value: 'cancelled' }] }], today } as never)
await run({ type: 'create-document', title: 'Todos', body: '', pageId: 'todos' })
await run({ type: 'save-editor', pageId: 'todos', expectedContent: pageContentKey(ws.pages.find(x => x.id === 'todos')!), document: JSON.stringify([{ id: 'above', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'The line above', styles: {} }], children: [] }, { id: 'b1', type: 'database', props: { pageId: todosSourceId, view: linkedViewJson({ ...todosDatabase.views[0]!, id: 'all-todos', name: 'Table', layout: 'table', filter: [] }, 'all-todos') }, children: [] }]) })
console.log('seeded')
