// A disposable store for B21-11: Page A with a line above a database and rows, Page B with one line, and a synced block on both when `synced`.
// Usage: node --no-warnings tests/evidence/b21/inside-seed.ts <store-path> [synced]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/b21/inside-seed.ts <store-path> [synced] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const save = (pageId: string, nodes: object[]) => run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find(p => p.id === pageId)!), document: JSON.stringify(nodes) })
await run({ type: 'create-document', title: 'Page A', body: '', pageId: 'a' })
await run({ type: 'create-document', title: 'Page B', body: '', pageId: 'b' })
await run({ type: 'create-database', pageId: 'books', parentId: 'a', homeBlockId: 'home', title: 'Books' })
for (const [id, title] of [['one', 'First book'], ['two', 'Second book']] as const) await run({ type: 'add-row', databaseId: 'books', pageId: id, title, values: {}, at: new Date().toISOString() } as never)
const home = { id: 'home', type: 'database', props: { pageId: 'books' }, children: [] }
if (process.argv[3] === 'synced') {
  await save('a', [line('a0', 'Above on A'), { id: 'sa', type: 'syncedBlock', props: { syncId: 's1', roles: '' }, children: [line('a1', 'Shared line'), home] }, line('a2', 'Below on A')])
  await save('b', [line('b0', 'Above on B'), { id: 'sb', type: 'syncedBlock', props: { syncId: 's1', roles: '' }, children: [] }, line('b2', 'Below on B')])
} else {
  await save('a', [line('a0', 'Above on A'), home, line('a2', 'Below on A')])
  await save('b', [line('b0', 'Above on B')])
}
console.log('seeded', process.argv[2])
