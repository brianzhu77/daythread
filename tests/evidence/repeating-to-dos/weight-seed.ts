// A day as R1-18 measures it: 26 to-dos among 40 lines, with `repeating` of them (lines 0 to 24) repeating daily (none, to measure without).
// Line 25 never repeats: it is the plain to-do the tick is compared with.
// Usage: node --no-warnings tests/evidence/repeating-to-dos/weight-seed.ts <store-path> <today> [repeating]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today, repeating = '0'] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/repeating-to-dos/weight-seed.ts <store-path> <today> [repeating] (a throwaway SQLite file)'); process.exit(2) }
if (!(Number(repeating) >= 0 && Number(repeating) <= 25)) { console.error('repeating is a number from 0 to 25: line 25 never repeats'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
const lines = Array.from({ length: 40 }, (_, i) => i < 26
  ? { id: `line-${i}`, type: 'task', props: { taskId: `editor-task:line-${i}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: `To-do ${i} of the day`, styles: {} }], children: [] }
  : { id: `line-${i}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Line ${i} of the day`, styles: {} }], children: [] })
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(lines), today })
const id = (i: number) => ws.tasks.find(t => t.title === `To-do ${i} of the day`)!.id
const at = new Date().toISOString()
for (let i = 0; i < Number(repeating); i++) await run({ type: 'set-todo-repeat', taskId: id(i), repeat: { every: 'day', interval: 1, from: 'schedule' }, today, at })
console.log('seeded', path, repeating)
