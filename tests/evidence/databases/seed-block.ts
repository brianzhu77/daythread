// Seeds a disposable SQLite store (path as the argument, never his data): a page "Books" with a database block (home) between two lines.
// Usage: node tests/evidence/databases/seed-block.ts /tmp/x/ws.sqlite
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/databases/seed-block.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: any) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
const books = ws.pages.find(p => p.id === 'books')!
const doc = [{ id: 'l1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Before the table', styles: {} }], children: [] },
  { id: 'home', type: 'database', props: { pageId: 'list', view: '' }, children: [] },
  { id: 'l2', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'After the table', styles: {} }], children: [] }]
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(books), document: JSON.stringify(doc) })
await run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' })
console.log('seeded rev', ws.revision)
