// A disposable store (path as the argument, never his data): a page "Notes" with a button between two lines, and one at the very end.
// Usage: node --no-warnings tests/evidence/button-block/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/button-block/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: any) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const button = (id: string, label: string) => ({ id, type: 'button', props: { label, steps: '[{"kind":"addRow","later":true}]' }, children: [] })
const notes = ws.pages.find((p: any) => p.id === 'notes')!
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(notes), document: JSON.stringify([line('l1', 'Before it'), button('b1', 'Log a run'), line('l2', 'After it'), button('b2', '')]) })
console.log('seeded', ws.revision)
