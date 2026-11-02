// B16: a disposable SQLite store (path as the argument, never his data) with a written day and a subpage, and an empty day before it.
// Usage: node tests/evidence/b16/seed-day.ts <store-path> <today> <a past day with nothing written>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, date, blank] = process.argv.slice(2)
if (!storePath || !date || !blank) { console.error('Usage: node tests/evidence/b16/seed-day.ts <store-path> <today> <blank day>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'ensure-day', date: blank })
await run({ type: 'ensure-day', date })
const day = ws.pages.find(p => p.date === date)!
const line = { id: 'first', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Slept well', styles: {} }], children: [] }
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify([...JSON.parse(day.document), line]), today: date })
await run({ type: 'create-document', title: 'Trip notes', body: '', pageId: 'trip', parentId: day.id })
await run({ type: 'add-task', pageId: day.id, title: 'Call Sam', plannedOn: date })
// A date with a long label, for the header's fit.
await run({ type: 'ensure-day', date: '2026-09-30' })
const long = ws.pages.find(p => p.date === '2026-09-30')!
await run({ type: 'save-editor', pageId: long.id, expectedContent: pageContentKey(long), document: JSON.stringify([...JSON.parse(long.document), { ...line, id: 'long' }]), today: date })
console.log('seeded', date)
