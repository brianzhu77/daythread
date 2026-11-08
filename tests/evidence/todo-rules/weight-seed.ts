// A day as R1-18 measures it: 26 to-dos among 40 lines, a Log database, and with `rules` set, a To-dos rule adding a Log row on each tick.
// Usage: node --no-warnings tests/evidence/todo-rules/weight-seed.ts <store-path> <today> [rules]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today, rules] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/todo-rules/weight-seed.ts <store-path> <today> [rules] (a throwaway SQLite file)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
const lines = Array.from({ length: 40 }, (_, i) => i < 26
  ? { id: `line-${i}`, type: 'task', props: { taskId: `editor-task:line-${i}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: `To-do ${i} of the day`, styles: {} }], children: [] }
  : { id: `line-${i}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Line ${i} of the day`, styles: {} }], children: [] })
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(lines), today })
const steps = JSON.stringify({ v: 1, steps: [{ id: 's', kind: 'add-row', databaseId: 'log', databaseName: 'Log', title: 'Ticked', set: [] }] })
if (rules) await run({ type: 'change-database', pageId: 'source:tasks', change: { kind: 'addAutomation', automation: { id: 'r', name: 'Log a tick', active: true, triggers: [{ kind: 'property-edited', propertyId: 'status', name: 'Status' }], steps } } } as Action)
console.log('seeded', path, rules ? 'with a rule' : 'without')
