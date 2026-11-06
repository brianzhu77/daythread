// A day as R1-18 measures it: 26 to-dos among 40 lines, with `linked` of them blocked by the one before (none, to measure without).
// Usage: node --no-warnings tests/evidence/todo-dependency/weight-seed.ts <store-path> <today> [linked]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today, linked = '0'] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/todo-dependency/weight-seed.ts <store-path> <today> [linked] (a throwaway SQLite file)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
const lines = Array.from({ length: 40 }, (_, i) => i < 26
  ? { id: `line-${i}`, type: 'task', props: { taskId: `editor-task:line-${i}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: `To-do ${i} of the day`, styles: {} }], children: [] }
  : { id: `line-${i}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Line ${i} of the day`, styles: {} }], children: [] })
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(lines), today })
// Not supported by an older store: only this build's seeds link.
const id = (i: number) => ws.tasks.find(t => t.title === `To-do ${i} of the day`)!.id
for (let i = 1; i <= Number(linked); i++) await run({ type: 'link-tasks', taskId: id(i), add: [id(i - 1)], remove: [], at: new Date().toISOString() } as Action)
console.log('seeded', path, linked)
