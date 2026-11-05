// A disposable store for files in a page's body (B87): Notes with lines, and a page ending in a database to drop on.
// Usage: node tests/evidence/body-files/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/body-files/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'notes')!), document: JSON.stringify([line('a', 'First line'), line('b', 'Second line'), line('c', 'Third line')]) })
await run({ type: 'create-document', title: 'With a table', body: '', pageId: 'with-table' })
await run({ type: 'create-database', pageId: 'table-1', parentId: 'with-table', homeBlockId: 'table-block', title: 'A table' })
await run({ type: 'save-editor', pageId: 'with-table', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'with-table')!), document: JSON.stringify([line('t', 'Above the table'), { id: 'table-block', type: 'database', props: { pageId: 'table-1' }, children: [] }]) })
console.log('seeded', process.argv[2])
