// A disposable store for "Reminders are off" (B60): today with a chip still to come, and yesterday with one gone by.
// Usage: node --no-warnings tests/evidence/reminders/seed-line.ts <store-path> [past-only]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/reminders/seed-line.ts <store-path> [past-only] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const dayOf = (ahead: number) => new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() + ahead * 86_400_000))
const on = process.argv[3] === 'past-only' ? -1 : 1
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'notes')!), document: JSON.stringify([{ id: 'l1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Dentist ', styles: {} }, { type: 'dateMention', props: { eventId: 'ev1', date: dayOf(on), time: '15:00' } }], children: [] }]) })
console.log('seeded', process.argv[2])
