// A disposable store for B29: page A with four lines, page B with one, page C holding a link to A's second line.
// Usage: node tests/evidence/b29/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/b29/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const write = async (pageId: string, title: string, nodes: object[]) => {
  await run({ type: 'create-document', title, body: '', pageId })
  await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find(p => p.id === pageId)!), document: JSON.stringify(nodes) })
}
await write('a', 'Page A', [line('a1', 'First of A'), line('a2', 'Second of A'), line('a3', 'Third of A'), line('a4', 'Fourth of A')])
await write('b', 'Page B', [line('b1', 'Only line of B')])
await write('c', 'Page C', [{ id: 'c1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'See ', styles: {} }, { type: 'pageRef', props: { refId: 'r1', pageId: 'a', lineId: 'a2' } }], children: [] }])
console.log('seeded')
