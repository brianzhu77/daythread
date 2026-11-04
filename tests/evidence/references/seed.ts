// A disposable store for the references prototype: bookmarks under days, one saved on two days, a deep sub-page, a database with sub-items, a day that's linked to.
// Usage: node tests/evidence/references/seed.ts <store-path>  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/references/seed.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const doc = (blocks: unknown[]) => JSON.stringify(blocks)
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const write = async (pageId: string, blocks: unknown[]) => { const p = ws.pages.find(x => x.id === pageId)!; await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: doc([...JSON.parse(p.document ?? '[]').filter((b: { content?: unknown[]; type: string }) => b.type !== 'paragraph' || (b.content ?? []).length), ...blocks]) }) }
for (const date of ['2026-10-25', '2026-11-03']) await run({ type: 'ensure-day', date })
const link = (pageId: string, parentPageId: string, url: string, title: string) => run({ type: 'make-link-pages', parentPageId, items: [{ url, pageId, title }] })
await link('dan', 'day:2026-11-03', 'https://x.com/thedankoe/status/1', 'DAN KOE (@thedankoe) on X')
await write('dan', [{ id: 'q1', type: 'quote', props: {}, content: [{ type: 'text', text: 'How to figure out what you want to do with your life.', styles: {} }], children: [] }])
await link('essay', 'day:2026-10-25', 'https://www.example.com/essay', 'A long essay on attention')
await link('twice', 'day:2026-10-25', 'https://www.example.com/twice', 'Saved on two days')
await run({ type: 'create-document', title: 'Projects', body: '', pageId: 'projects' })
await run({ type: 'create-document', title: 'Daythread', body: '', pageId: 'daythread', parentId: 'projects' } as never)
await run({ type: 'create-document', title: 'Design notes and things to look at again', body: '', pageId: 'notes', parentId: 'daythread' } as never)
await run({ type: 'create-document', title: 'R4 review', body: '', pageId: 'r4', parentId: 'notes' } as never)
await run({ type: 'create-document', title: 'Column heads', body: '', pageId: 'heads', parentId: 'r4' } as never)
await run({ type: 'create-database', pageId: 'work', parentId: 'projects', homeBlockId: null, title: 'Work' } as never)
const change = (c: never) => run({ type: 'change-database', pageId: 'work', change: c })
const at = new Date().toISOString()
for (const [id, title] of [['launch', 'Launch the app'], ['site', 'Build the site'], ['copy', 'Write the copy'], ['other', 'Something else']] as const) await run({ type: 'add-row', databaseId: 'work', pageId: id, title, values: {}, at })
await change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } as never)
for (const [id, parent] of [['site', 'launch'], ['copy', 'site']] as const) await run({ type: 'set-values', pageId: id, values: { par: [parent] }, expected: {}, at } as never)
const card = (id: string, pageId: string) => ({ id, type: 'pageLink', props: { pageId }, children: [] })
await write('day:2026-11-03', [line('n1', 'Reading list for the week'), card('c1', 'dan'), card('c2', 'twice'), line('n2', 'Call the bank at 3')])
await write('day:2026-10-25', [line('o1', 'Saved a few things'), card('c3', 'essay'), card('c4', 'twice')])
await write('projects', [line('p1', 'What came out of the week'), card('c5', 'day:2026-11-03')])
await write('notes', [card('c6', 'heads')])
await write('r4', [line('r1', 'See also the essay'), card('c7', 'essay')])
console.log('seeded', process.argv[2], ws.pages.filter(p => p.type === 'link' || p.url).map(p => p.id).join())
