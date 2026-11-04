// On a throwaway copy of his data: a note in a synced block on its own page, and a copy of it under his Day template's first heading.
// Usage: node tests/evidence/b21/template-seed.ts <copy-store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { defaultTemplate, dayPagesTarget } from '../../../src/domain/day-template.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/b21/template-seed.ts <copy-store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2])
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'create-document', title: 'Standing notes', body: '', pageId: 'notes' })
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'notes')!), document: JSON.stringify([{ id: 'home', type: 'syncedBlock', props: { syncId: 'standing', roles: '' }, children: [line('n1', 'One standing note #standing')] }]) })
const template = defaultTemplate(ws, dayPagesTarget)
if (!template) { console.error('No Day template on this copy'); process.exit(1) }
const doc = JSON.parse(template.document) as { type: string }[]
doc.splice(doc.findIndex(n => n.type === 'heading') + 1, 0, { id: 'in-template', type: 'syncedBlock', props: { syncId: 'standing', roles: '' }, children: [] } as never)
await run({ type: 'save-editor', pageId: template.id, expectedContent: pageContentKey(template), document: JSON.stringify(doc) })
console.log('seeded')
