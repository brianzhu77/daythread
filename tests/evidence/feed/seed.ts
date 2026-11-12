// A disposable store for Feed: Notes, a database with Created time and Kind, five rows with bodies (a long one, a to-do,
// a list, a [[link]], an empty one), shown as a Feed on a page of its own. Usage: node --no-warnings tests/evidence/feed/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path) { console.error('Usage: node --no-warnings tests/evidence/feed/seed.ts <store-path> (a throwaway SQLite file)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const text = (t: string, styles: Record<string, boolean> = {}) => ({ type: 'text', text: t, styles })
const para = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', props: {}, content: content as never, children: [] })
const at = new Date().toISOString()
await run({ type: 'create-document', title: 'Reading', body: '', pageId: 'reading' })
await run({ type: 'save-editor', pageId: 'reading', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'reading')!), document: JSON.stringify([{ id: 'feedhome', type: 'database', props: { pageId: 'notes', view: '' }, children: [] }]) })
await run({ type: 'create-database', pageId: 'notes', parentId: 'reading', homeBlockId: 'feedhome', title: 'Notes' })
const C = (change: unknown) => run({ type: 'change-database', pageId: 'notes', change } as never)
await C({ kind: 'addProperty', property: { id: 'made', name: 'Created', type: 'createdTime' } })
await C({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'book', name: 'Book' }, { id: 'idea', name: 'Idea' }] } })
const rows: [string, string, string, EditorNode[]][] = [
  ['n1', 'On slow mornings', 'idea', [para('a1', text('The first hour sets the day. '), text('Writing before reading', { bold: true }), text(' keeps it mine.')), { id: 'a2', type: 'bulletListItem', props: {}, content: [text('Tea, not the phone')] as never, children: [] }, { id: 'a3', type: 'bulletListItem', props: {}, content: [text('One page, any page')] as never, children: [] }]],
  ['n2', 'A long one', 'book', Array.from({ length: 16 }, (_, i) => para(`l${i}`, text(`Paragraph ${i + 1}: a line long enough to wrap at a phone's width, so the cap by height has something to cut.`)))],
  ['n3', 'Things to do from it', 'idea', [para('t0', text('From the chapter on habits:')), { id: 't1', type: 'task', props: { taskId: 'editor-task:t1', role: 'reference', planDate: '' }, content: [text('Try the two-minute rule')] as never, children: [] }]],
  ['n4', 'See also', 'book', [para('r1', text('Pairs with '), { type: 'pageRef', props: { pageId: 'reading', refId: 'ref1', newTitle: '', lineId: '', taskId: '' } }, text(' and the quote below.')), { id: 'q1', type: 'quote', props: {}, content: [text('Slow is fast.')] as never, children: [] },
    { id: 'tg', type: 'toggleListItem', props: {}, content: [text('Folded notes')] as never, children: [para('tg1', text('Hidden under the toggle'))] },
    para('bad', { type: 'link', href: 'javascript:alert(1)', content: [text('not a link')] }, text(' and '), { type: 'link', href: 'https://example.com/ok', content: [text('a real one')] })]],
  ['n5', 'Empty for now', 'idea', []],
]
for (const [id, title, kind, body] of rows) {
  await run({ type: 'add-row', databaseId: 'notes', pageId: id, title, values: { kind }, at })
  if (body.length) await run({ type: 'save-editor', pageId: id, expectedContent: pageContentKey(ws.pages.find(p => p.id === id)!), document: JSON.stringify(body) })
}
const view = ws.pages.find(p => p.id === 'notes')!.database!.views[0]!
await C({ kind: 'updateView', viewId: view.id, layout: 'feed', name: 'Feed', columns: [{ id: 'made' }, { id: 'kind' }], sort: [{ by: 'made', direction: 'desc' }] })
console.log('seeded')
