// A disposable store for moving a row (R4-10): Books and Shelf with some of the same properties, People linking back.
// Usage: node tests/evidence/move-row/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/move-row/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const add = (pageId: string, property: object) => run({ type: 'change-database', pageId, change: { kind: 'addProperty', property } as DatabaseChange })
const at = new Date().toISOString()
for (const [id, title] of [['books', 'Books'], ['shelf', 'Shelf'], ['same', 'Same'], ['people', 'People']] as const) await run({ type: 'create-database', pageId: id, homeBlockId: null, title })
await add('books', { id: 'pages', name: 'Pages', type: 'number' }); await add('books', { id: 'rating', name: 'Rating', type: 'number' })
await add('books', { id: 'genre', name: 'Genre', type: 'select', options: [{ id: 'sf', name: 'SF' }] })
await add('shelf', { id: 'pages2', name: 'Pages', type: 'number' }); await add('shelf', { id: 'genre2', name: 'Genre', type: 'select', options: [{ id: 'novel', name: 'Novel' }] })
await add('same', { id: 'pages3', name: 'Pages', type: 'number' }); await add('same', { id: 'rating3', name: 'Rating', type: 'number' }); await add('same', { id: 'genre3', name: 'Genre', type: 'select', options: [{ id: 'sf3', name: 'SF' }] })
await add('people', { id: 'fav', name: 'Favourite', type: 'relation', target: 'books' })
await run({ type: 'add-row', databaseId: 'books', pageId: 'dune', title: 'Dune', values: { pages: 412, rating: 5, genre: 'sf' }, at })
await run({ type: 'add-row', databaseId: 'books', pageId: 'emma', title: 'Emma', values: { pages: 300 }, at })
await run({ type: 'add-row', databaseId: 'people', pageId: 'ann', title: 'Ann', values: { fav: ['dune'] }, at })
const emma = ws.pages.find(p => p.id === 'emma')!
await run({ type: 'save-editor', pageId: 'emma', expectedContent: pageContentKey(emma), document: JSON.stringify([{ id: 'body1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'The body of Emma', styles: {} }], children: [] }]), today: new Date().toISOString().slice(0, 10) })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
const notes = ws.pages.find(p => p.id === 'notes')!
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(notes), document: JSON.stringify([{ id: 'n1', type: 'paragraph', props: {}, content: [{ type: 'pageRef', props: { pageId: 'emma' } }], children: [] }]), today: new Date().toISOString().slice(0, 10) })
console.log('seeded', process.argv[2])
