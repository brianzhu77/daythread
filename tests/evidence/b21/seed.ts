// A disposable store for B21's first step: a synced block on two pages. Nothing in the app can make one yet, so it's written directly.
// Usage: node tests/evidence/b21/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/b21/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const block = (id: string, children: object[] = []) => ({ id, type: 'syncedBlock', props: { syncId: 's1', roles: '' }, children })
const write = async (pageId: string, title: string, nodes: object[]) => {
  await run({ type: 'create-document', title, body: '', pageId })
  await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find(p => p.id === pageId)!), document: JSON.stringify(nodes) })
}
await write('a', 'Page A', [line('a1', 'Above on A'), block('sa', [line('l1', 'Shared one'), line('l2', 'Shared two')]), line('a2', 'Below on A')])
await write('b', 'Page B', [line('b1', 'Above on B'), block('sb'), line('b2', 'Below on B')])
console.log('seeded')
