// A disposable store for comments (comments.md step 1): Notes with words, Other beside it, Books with a row, and today with a line.
// Usage: node --no-warnings tests/evidence/comments/seed.ts <store-path>
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/comments/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const save = (pageId: string, nodes: object[]) => run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find(p => p.id === pageId)!), document: JSON.stringify(nodes) })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'create-document', title: 'Other', body: '', pageId: 'other' })
await save('notes', [line('n1', 'A line of notes')])
await run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
const at = new Date().toISOString()
await run({ type: 'add-row', databaseId: 'books', pageId: 'one', title: 'First book', values: {}, at } as never)
// Engines can disagree on today near midnight, as time zone data differs between them, and an empty day has no menu. So both have a line.
for (const today of new Set([new Intl.DateTimeFormat('en-CA').format(new Date()), execSync('date +%F').toString().trim()])) {
  await run({ type: 'ensure-day', date: today })
  const day = ws.pages.find(p => p.date === today)!
  await save(day.id, [...JSON.parse(day.document), line(`d-${today}`, 'Written today')])
}
console.log('seeded', process.argv[2])
