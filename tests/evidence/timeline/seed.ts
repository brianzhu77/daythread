// A disposable store for Timeline (R4-1, R4-2): a Plans database with one row of each kind in timeline.md §3, around today, and a view by one Date.
// Usage: node tests/evidence/timeline/seed.ts <store-path> [todos]  (a throwaway store, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/timeline/seed.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'plans', change: c })
const at = new Date().toISOString()
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
await run({ type: 'create-database', pageId: 'plans', homeBlockId: null, title: 'Plans' })
await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'from', name: 'From', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'to', name: 'To', type: 'date' } })
await change({ kind: 'addProperty', property: { id: 'made', name: 'Made', type: 'createdTime' } })
const add = (pageId: string, title: string, values: Record<string, unknown>) => run({ type: 'add-row', databaseId: 'plans', pageId, title, values: values as never, at })
await add('trip', 'Trip', { when: { start: day(1), end: day(5) }, from: { start: day(1) }, to: { start: day(5) } })
await add('call', 'Call', { when: { start: day(3) }, from: { start: day(3) } })
await add('ends', 'Ends only', { when: { start: day(4), end: day(4) }, to: { start: day(4) } })
await add('back', 'Backwards', { when: { start: day(-1) }, from: { start: day(2) }, to: { start: day(-1) } })
await add('old', 'Long ago', { when: { start: day(-40), end: day(-38) } })
await add('run', 'Running', { when: { start: day(-9), end: day(9) } })
await add('none', 'No dates yet', {})
const view = ws.pages.find(p => p.id === 'plans')!.database!.views[0]!
await change({ kind: 'updateView', viewId: view.id, layout: 'timeline', name: 'Timeline', dateBy: 'when' })
// `todos`: a To-dos Timeline by Start and Deadline on a page, with a to-do on a day page.
if (process.argv[3] === 'todos') {
  const today = day(0)
  await run({ type: 'ensure-day', date: today })
  await run({ type: 'add-task', pageId: ws.pages.find(p => p.date === today)!.id, title: 'Water the plants', plannedOn: today })
  const task = ws.tasks.find(t => t.title === 'Water the plants')!
  await run({ type: 'set-task-dates', taskId: task.id, attentionOn: day(1), deadlineOn: day(3) })
  await run({ type: 'create-document', title: 'Holder', body: '', pageId: 'holder' })
  const block = { id: 'tl', type: 'database', props: { pageId: todosSourceId, view: linkedViewJson({ ...todosDatabase.views[0]!, id: 'todos-tl', name: 'Timeline', layout: 'timeline', filter: [], dateBy: 'start', timelineEnd: 'deadline' }, 'todos-tl') }, children: [] }
  await run({ type: 'save-editor', pageId: 'holder', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'holder')!), document: JSON.stringify([block, { id: 'tail', type: 'paragraph', props: {}, content: [], children: [] }]) })
}
console.log('seeded')
