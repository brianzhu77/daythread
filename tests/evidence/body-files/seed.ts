// A disposable store for files in a page's body (B87): Notes with lines, and a page ending in a database to drop on.
// Usage: node tests/evidence/body-files/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/body-files/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'notes')!), document: JSON.stringify([line('a', 'First line'), line('b', 'Second line'), line('c', 'Third line')]) })
await run({ type: 'create-document', title: 'With a table', body: '', pageId: 'with-table' })
await run({ type: 'create-database', pageId: 'table-1', parentId: 'with-table', homeBlockId: 'table-block', title: 'A table' })
await run({ type: 'save-editor', pageId: 'with-table', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'with-table')!), document: JSON.stringify([line('t', 'Above the table'), { id: 'table-block', type: 'database', props: { pageId: 'table-1' }, children: [] }]) })
// Days: a past one with written lines, and yesterday's open to-do for today to carry.
const dayOf = (back: number) => new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date(Date.now() - back * 86_400_000))
const write = async (date: string, lines: ReturnType<typeof line>[]) => {
  await run({ type: 'ensure-day', date })
  const day = () => ws.pages.find(p => p.date === date && p.type === 'daily')!
  await run({ type: 'save-editor', pageId: day().id, expectedContent: pageContentKey(day()), document: JSON.stringify([...JSON.parse(day().document), ...lines]) })
}
await write(dayOf(3), [line('past-1', 'Written that day'), line('past-2', 'And after it')])
await write(dayOf(1), [line('yest-1', 'Yesterday wrote this')])
await run({ type: 'add-task', pageId: ws.pages.find(p => p.date === dayOf(1))!.id, title: 'Carried to-do', plannedOn: dayOf(1) })
console.log('seeded', process.argv[2])
