// B22: a disposable SQLite store (path as the argument, never his data): a day with two to-dos, and a page "Trips" with an empty line.
// Usage: node tests/evidence/b22/seed.ts <store-path> <today>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, date] = process.argv.slice(2)
if (!storePath || !date) { console.error('Usage: node tests/evidence/b22/seed.ts <store-path> <today>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'ensure-day', date })
await run({ type: 'add-task', pageId: `day:${date}`, title: 'TRV', plannedOn: date })
await run({ type: 'add-task', pageId: `day:${date}`, title: 'Book the train', plannedOn: date })
await run({ type: 'create-document', title: 'Trips', body: '', pageId: 'trips' })
const trips = ws.pages.find(p => p.id === 'trips')!
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] })
await run({ type: 'save-editor', pageId: 'trips', expectedContent: pageContentKey(trips), document: JSON.stringify([line('first', 'Trip notes'), line('here', '')]) })
await run({ type: 'create-document', title: 'Later', body: '', pageId: 'later' })
await run({ type: 'create-template', title: 'A template', pageId: 'tpl' })
console.log('seeded')
