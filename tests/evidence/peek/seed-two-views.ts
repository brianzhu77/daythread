// A disposable store for ↑ ↓ in a peek (Ratchet, side-peek-ratchet.md): board/seed-board.ts's Books, with a second view of the same database sorted the other way, both opening at the side.
// Usage: node tests/evidence/peek/seed-two-views.ts <store-path>, after board/seed-board.ts on it  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/peek/seed-two-views.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const view = ws.pages.find(p => p.id === 'list')!.database!.views[0]!
ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: view.id, openIn: 'side' } } })).workspace
const books = ws.pages.find(p => p.id === 'books')!, nodes = JSON.parse(books.document!) as { type: string; props: object }[]
const home = nodes.find(n => n.type === 'database')!
nodes.push({ id: 'second-table', type: 'database', props: { ...home.props, view: linkedViewJson({ ...view, openIn: 'side', sort: [{ by: 'title', direction: 'desc' }] }, 'second-view') }, children: [] } as never)
await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-editor', pageId: books.id, expectedContent: pageContentKey(books), document: JSON.stringify(nodes) } })
console.log('seeded', process.argv[2])
