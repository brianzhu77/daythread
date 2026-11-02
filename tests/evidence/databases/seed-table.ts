// Seeds a disposable SQLite store (path as the argument, never his data): "Books" with an inline Reading list (one property
// of each R1 type, three rows) between two lines, plus a full-page database "Films" at the top level.
// Usage: node tests/evidence/databases/seed-table.ts /tmp/x/ws.sqlite
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'books')!), document: JSON.stringify([line('l1', 'Before the table'), { id: 'home', type: 'database', props: { pageId: 'list', view: '' }, children: [] }, line('l2', 'After the table')]) })
await run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' })
const prop = (id: string, name: string, type: string, extra: object = {}) => run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id, name, type, ...extra } as never } })
await prop('status', 'Status', 'status')
await prop('pages', 'Pages', 'number')
await prop('genre', 'Genre', 'select', { options: [{ id: 'novel', name: 'Novel' }, { id: 'essay', name: 'Essay' }] })
await prop('tags', 'Tags', 'multiSelect', { options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] })
await prop('due', 'Due', 'date')
await prop('owned', 'Owned', 'checkbox')
await prop('link', 'Link', 'url')
await prop('notes', 'Notes', 'text')
const status = (name: string) => ws.pages.find(p => p.id === 'list')!.database!.properties[0]!.options!.find(o => o.name === name)!.id
await run({ type: 'add-row', databaseId: 'list', pageId: 'dune', title: 'Dune', values: { status: status('In progress'), pages: 412, genre: 'novel', tags: ['sf'], due: { start: '2026-11-05' }, owned: true, link: 'https://example.com/dune', notes: 'Spice' }, at })
await run({ type: 'add-row', databaseId: 'list', pageId: 'emma', title: 'Emma', values: { pages: 300, genre: 'novel', tags: ['hist'] }, at })
await run({ type: 'add-row', databaseId: 'list', pageId: 'ubik', title: 'Ubik', values: { status: status('Done'), tags: ['sf', 'hist'] }, at })
await run({ type: 'create-database', pageId: 'films', homeBlockId: null, title: 'Films' })
console.log('seeded rev', ws.revision)
