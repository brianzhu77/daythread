// On top of sub-items/seed.ts's `timeline`: a filter that only a sub-item matches, or a table closed, for the Timeline's rows (R4-1, R4-4).
// `peek`: other's page holds a Timeline of the same rows, under a line of text, to try it in a peek.
// Usage: node tests/evidence/timeline/seed-rows.ts <store-path> [closed] [filter] [peek]  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed-rows.ts <store-path> [closed] [filter] [peek]'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const change = async (c: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'change-database', pageId: 'work', change: c } as never })).workspace }
const view = ws.pages.find(p => p.id === 'work')!.database!.views[0]!, args = process.argv.slice(3)
// Long enough to hold a name past what's at the left. A one-day bar can't: its name can't leave its bar.
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
for (const [id, from] of [['top', 1], ['other', 5]] as const) ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'set-values', pageId: id, values: { when: { start: day(from), end: day(from + 8) } }, expected: {}, at: new Date().toISOString() } as never })).workspace
if (args.includes('closed')) await change({ kind: 'updateView', viewId: view.id, timelineTable: null })
if (args.includes('filter')) await change({ kind: 'updateView', viewId: view.id, filter: [{ by: 'n', op: 'eq', value: 3 }] })
for (const layout of ['table', 'list'] as const) await change({ kind: 'addView', view: { ...view, id: `v-${layout}`, name: layout, layout, ...(args.includes('filter') ? { filter: [{ by: 'n', op: 'eq', value: 3 }] } : {}) } })
if (args.includes('peek')) {
  const other = ws.pages.find(p => p.id === 'other')!, shownView = ws.pages.find(p => p.id === 'work')!.database!.views[0]!
  const document = [{ id: 'line', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'A line above', styles: {} }], children: [] }, { id: 'inner', type: 'database', props: { pageId: 'work', view: linkedViewJson(shownView, 'v-inner') }, children: [] }]
  ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-editor', pageId: 'other', expectedContent: pageContentKey(other), document: JSON.stringify(document), today: day(0) } as never })).workspace
}
console.log('seeded', process.argv[2])
