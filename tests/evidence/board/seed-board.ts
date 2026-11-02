// Board and Group: a disposable SQLite store (path as the argument, never his data) with a page "Books" holding a database
// with one property of each type a view can group by, and rows; 30 rows in one status, for the cap.
// Usage: node tests/evidence/board/seed-board.ts <store-path> [board]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, asBoard] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/board/seed-board.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
await run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' })
const host = ws.pages.find(p => p.id === 'books')!
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(host), document: JSON.stringify([line('above', 'The line above'), { id: 'home', type: 'database', props: { pageId: 'list', view: '' }, children: [] }, line('below', 'The line below')]) })
const change = (c: Extract<Action, { type: 'change-database' }>['change']) => run({ type: 'change-database', pageId: 'list', change: c })
await change({ kind: 'addProperty', property: { id: 'status', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'To read', group: 'todo' }, { id: 'now', name: 'Reading', group: 'active' }, { id: 'done', name: 'Finished', group: 'done' }] } })
await change({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'novel', name: 'Novel' }, { id: 'essay', name: 'Essay' }] } })
await change({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] } })
await change({ kind: 'addProperty', property: { id: 'pages', name: 'Pages', type: 'number' } })
await change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'owned', name: 'Owned', type: 'checkbox' } })
const add = (pageId: string, title: string, values: Record<string, unknown>) => run({ type: 'add-row', databaseId: 'list', pageId, title, values: values as never, at })
await add('dune', 'Dune', { status: 'now', kind: 'novel', tags: ['sf'], pages: 412, due: { start: '2026-10-25' }, owned: true })
await add('emma', 'Emma', { status: 'todo', kind: 'novel', tags: ['hist', 'sf'], pages: 300, due: { start: '2026-11-20' } })
await add('ubik', 'Ubik', { status: 'done', kind: 'essay', pages: 300 })
await add('blank', 'No kind yet', { status: 'todo' })
for (let i = 1; i <= 30; i++) await add(`f${i}`, `Finished ${i}`, { status: 'done', kind: 'essay' })
// A second argument makes the first view a board by Status, with Owned on its cards.
if (asBoard === 'board') {
  const viewId = (ws.pages.find(p => p.id === 'list')!.database!).views[0]!.id
  await change({ kind: 'updateView', viewId, layout: 'board', groupBy: 'status', name: 'Board', columns: [{ id: 'owned' }] })
}
console.log('seeded')
