// B82: a disposable SQLite store (path as the argument, never his data) with a filled day: 6 lines under TODO and 20 under Notes.
// Usage: node tests/evidence/b82/seed-filled-day.ts <store-path> <date, as the phone sees today>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, date] = process.argv.slice(2)
if (!storePath || !date) { console.error('Usage: node tests/evidence/b82/seed-filled-day.ts <store-path> <date>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'ensure-day', date })
const day = ws.pages.find(p => p.date === date)!
const bullet = (id: string, text: string) => ({ id, type: 'bulletListItem', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const base = JSON.parse(day.document)
const doc = [base[0], ...Array.from({ length: 6 }, (_, i) => bullet(`t${i}`, `Task ${i} for today`)), ...base.slice(1), ...Array.from({ length: 20 }, (_, i) => bullet(`l${i}`, `Line ${i} of the day, with a few words in it`))]
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(doc), today: date })
console.log('seeded', date)
