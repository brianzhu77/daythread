// On a throwaway copy with seed-table.ts applied: two linked views in the Day template, one under its first heading and one
// under its last, filtered to "this page's day", and two rows due on the days template-view.mjs opens. Usage: ... <store> [plain|todos|chart]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { defaultTemplate, dayPagesTarget } from '../../../src/domain/day-template.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/databases/template-view-seed.ts <copy-store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2])
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'add-row', databaseId: 'list', pageId: 'due20', title: 'Due the 20th', values: { due: { start: '2026-12-20' } }, at })
await run({ type: 'add-row', databaseId: 'list', pageId: 'due21', title: 'Due the 21st', values: { due: { start: '2026-12-21' } }, at })
const template = defaultTemplate(ws, dayPagesTarget)
if (!template) { console.error('No Day template on this copy'); process.exit(1) }
const list = ws.pages.find(p => p.id === 'list')!
const view = (id: string) => ({ id, type: 'database', props: { pageId: 'list', view: JSON.stringify({ ...JSON.parse(linkedViewJson(list.database!.views[0]!)), filter: [{ by: 'due', op: 'is', value: { relative: 'pageDate' } }] }) }, children: [] })
// `todos`: the same two places, showing To-dos.
const todosView = (id: string) => ({ id, type: 'database', props: { pageId: todosSourceId, view: linkedViewJson(todosDatabase.views[0]!) }, children: [] })
// `chart` (G4-7): the same, as charts by Status: bars in the first place and a Number in the second.
const chartView = (id: string) => ({ id, type: 'database', props: { pageId: 'list', view: JSON.stringify({ ...JSON.parse(linkedViewJson(list.database!.views[0]!)), layout: 'chart', groupBy: 'status', chart: { form: id === 'tv1' ? 'bar' : 'number' }, filter: [{ by: 'due', op: 'is', value: { relative: 'pageDate' } }] }) }, children: [] })
const doc = JSON.parse(template.document) as { id: string; type: string }[]
const headings = doc.flatMap((n, i) => (n.type === 'heading' ? [i] : []))
const out = [...doc]
const make = process.argv[3] === 'todos' ? todosView : process.argv[3] === 'chart' ? chartView : view
// A day made before the template had charts, which a chart check opens as a day with none.
if (process.argv[3] === 'chart') await run({ type: 'ensure-day', date: '2026-12-19' })
out.splice(headings.at(-1)! + 1, 0, make('tv2'))
out.splice(headings[0]! + 1, 0, make('tv1'))
// `plain` leaves the template alone, for comparing a day with the views against one without (template-draft.ts).
if (process.argv[3] !== 'plain') await run({ type: 'save-editor', pageId: template.id, expectedContent: pageContentKey(template), document: JSON.stringify(out) })
console.log('template has', process.argv[3] === 'plain' ? 0 : out.filter(n => n.type === 'database').length, 'views')
// Making a day is one operation, and makes nothing but the day (and any carried-over rows it always did).
for (const date of ['2026-12-20', '2026-12-21']) {
  const databases = ws.pages.filter(p => p.database).length, tasks = ws.tasks.length, revision = ws.revision
  await run({ type: 'ensure-day', date })
  console.log(date, 'operations', ws.revision - revision, 'databases made', ws.pages.filter(p => p.database).length - databases, 'tasks made', ws.tasks.length - tasks)
}
