// A disposable store for CSV (R4-7 to R4-9): Books with every plain type, a comma, a newline, Chinese and text a spreadsheet would run.
// Usage: node tests/evidence/csv/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/csv/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const add = (property: object) => run({ type: 'change-database', pageId: 'books', change: { kind: 'addProperty', property } as DatabaseChange })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
await add({ id: 'pages', name: 'Pages', type: 'number' }); await add({ id: 'read', name: 'Read', type: 'date' }); await add({ id: 'owned', name: 'Owned', type: 'checkbox' }); await add({ id: 'notes', name: 'Notes', type: 'text' })
await add({ id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] })
await run({ type: 'add-row', databaseId: 'books', pageId: 'dune', title: '沙丘, Dune', values: { pages: 412, read: { start: '2026-01-02', end: '2026-01-09' }, owned: true, notes: 'two\nlines, "quoted"', tags: ['sf', 'hist'] }, at })
await run({ type: 'add-row', databaseId: 'books', pageId: 'emma', title: 'Emma', values: { pages: -5, notes: '=HYPERLINK("http://x")' }, at })
await run({ type: 'add-row', databaseId: 'books', pageId: 'gone', title: 'Short', values: { pages: 3 }, at })
const dune = ws.pages.find(p => p.id === 'dune')!
await run({ type: 'save-editor', pageId: 'dune', expectedContent: pageContentKey(dune), document: JSON.stringify([{ id: 'body1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'A body for Dune', styles: {} }], children: [] }]), today: new Date().toISOString().slice(0, 10) })
const db = ws.pages.find(p => p.id === 'books')!.database!
if (process.argv[3] !== 'all') await run({ type: 'change-database', pageId: 'books', change: { kind: 'updateView', viewId: db.views[0]!.id, columns: [{ id: 'pages' }, { id: 'notes' }], filter: [{ by: 'pages', op: 'gt', value: 100 }] } })
console.log('seeded', process.argv[2])
