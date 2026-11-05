// A disposable store for icons (icons-covers.md): Notes with a child card and a line, Links holding a [[ link and a card to Notes, Books with rows in several views, and today with a line.
// Usage: node --no-warnings tests/evidence/page-icons/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/page-icons/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, text: string, extra: object[] = []) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }, ...extra], children: [] })
const save = (pageId: string, nodes: object[]) => run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find(p => p.id === pageId)!), document: JSON.stringify(nodes) })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'create-document', title: 'Links', body: '', pageId: 'links' })
await run({ type: 'create-document', title: 'Child', body: '', pageId: 'child', parentId: 'notes' })
await save('notes', [line('n1', 'A line of notes'), line('n2', 'Another line')])
await save('links', [line('l1', 'See ', [{ type: 'pageRef', props: { refId: 'ref-1', pageId: 'notes', at: 1 } }]), { id: 'l2', type: 'pageLink', props: { pageId: 'notes' }, children: [] }])
await run({ type: 'create-database', pageId: 'books', homeBlockId: null, title: 'Books' })
const at = new Date().toISOString(), today = new Intl.DateTimeFormat('en-CA').format(new Date())
await run({ type: 'add-row', databaseId: 'books', pageId: 'one', title: 'First book', values: {}, at } as never)
await run({ type: 'add-row', databaseId: 'books', pageId: 'two', title: 'Second book', values: {}, at } as never)
// Every other layout, to see a row's icon in each, with a date for the two that place by it.
await run({ type: 'change-database', pageId: 'books', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } } })
await run({ type: 'set-values', pageId: 'one', values: { when: { start: today } }, expected: {}, at } as never)
const base = ws.pages.find(p => p.id === 'books')!.database!.views[0]!
for (const layout of ['list', 'board', 'gallery', 'calendar', 'timeline'] as const) await run({ type: 'change-database', pageId: 'books', change: { kind: 'addView', view: { ...base, id: `v-${layout}`, name: layout, layout, ...(layout === 'calendar' || layout === 'timeline' ? { dateBy: 'when' } : {}), ...(layout === 'timeline' ? { timelineTable: true } : {}) } as never } })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.date === today)!
await save(day.id, [...JSON.parse(day.document), line('d1', 'Written today')])
console.log('seeded', process.argv[2])
