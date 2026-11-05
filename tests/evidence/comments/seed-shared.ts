// A disposable store for comments on a synced line (comments.md §4): Notes holding a synced block of two lines, Other holding a place of it.
// Usage: node --no-warnings tests/evidence/comments/seed-shared.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/comments/seed-shared.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: any) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const block = (id: string, children: unknown[] = []) => ({ id, type: 'syncedBlock', props: { syncId: 'sync1', roles: '' }, children })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'create-document', title: 'Other', body: '', pageId: 'other' })
const save = (id: string, nodes: unknown[]) => run({ type: 'save-editor', pageId: id, expectedContent: pageContentKey(ws.pages.find(p => p.id === id)!), document: JSON.stringify(nodes) })
await save('notes', [line('n0', 'A plain line'), block('sa', [line('s1', 'First shared'), line('s2', 'Second shared')])])
await save('other', [line('o0', 'Over here'), block('sb')])
console.log('seeded', ws.revision)
