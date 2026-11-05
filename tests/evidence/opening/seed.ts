// A disposable store for opening a page (B88): one page ending in each block with no text, one ending in a line, a row whose body ends in a card, and a Reading database to pick from.
// Usage: node tests/evidence/opening/seed.ts <store-path>  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/opening/seed.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (a: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: a as never })).workspace }
const line = (id: string, t: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] })
const write = async (pageId: string, nodes: unknown[]) => { const p = ws.pages.find(x => x.id === pageId)!; await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(nodes) }) }
const doc = (pageId: string) => run({ type: 'create-document', title: pageId, body: '', pageId })
const at = new Date().toISOString()
await doc('elsewhere')
await doc('home')
await run({ type: 'create-database', pageId: 'home-db', parentId: 'home', homeBlockId: 'home-b', title: 'Reading' })
for (const [id, title] of [['one', 'First row'], ['two', 'Second row']]) await run({ type: 'add-row', databaseId: 'home-db', pageId: id, title, values: {}, at })
await write('home', [line('home-above', 'The line above'), { id: 'home-b', type: 'database', props: { pageId: 'home-db' }, children: [] }])
await doc('alone')
await run({ type: 'create-database', pageId: 'alone-db', parentId: 'alone', homeBlockId: 'alone-b', title: 'Alone' })
await write('alone', [{ id: 'alone-b', type: 'database', props: { pageId: 'alone-db' }, children: [] }])
const view = ws.pages.find(p => p.id === 'home-db')!.database!.views[0]!
const ending: Record<string, unknown> = {
  linked: { id: 'e-linked', type: 'database', props: { pageId: 'home-db', view: linkedViewJson({ ...view, id: 'lv' }, 'lv') }, children: [] },
  todos: { id: 'e-todos', type: 'database', props: { pageId: todosSourceId, view: linkedViewJson({ ...todosDatabase.views[0]!, id: 'tv' }, 'tv') }, children: [] },
  card: { id: 'e-card', type: 'pageLink', props: { pageId: 'elsewhere' }, children: [] },
  divider: { id: 'e-divider', type: 'divider', props: {}, children: [] },
  synced: { id: 'e-synced', type: 'syncedBlock', props: { syncId: 'standing', roles: '' }, children: [line('e-synced-1', 'A line inside')] },
}
for (const [pageId, node] of Object.entries(ending)) { await doc(pageId); await write(pageId, [line(`${pageId}-above`, 'The line above'), node]) }
await doc('endsline')
await write('endsline', [{ id: 'l-card', type: 'pageLink', props: { pageId: 'elsewhere' }, children: [] }, line('l-below', 'The line below')])
// A row whose body ends in a card, for the peek.
const row = ws.pages.find(p => p.id === 'one')!
await run({ type: 'save-editor', pageId: 'one', expectedContent: pageContentKey(row), document: JSON.stringify([line('r-above', 'Row words'), { id: 'r-card', type: 'pageLink', props: { pageId: 'elsewhere' }, children: [] }]) })
console.log('seeded')
