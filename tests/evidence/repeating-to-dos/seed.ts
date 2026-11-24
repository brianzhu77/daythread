// A disposable store for repeating to-dos (repeating-to-dos.md): today's page with six to-dos, four of them repeating; tomorrow's page with
// a reference line for Take the bins out; Notes, a document with a reference line for Weekly review; Lists, a page with a To-dos view.
// Usage: node --no-warnings tests/evidence/repeating-to-dos/seed.ts <store-path> <today> [plain]  (`plain`: no repeats)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import { addDays } from '../../../src/domain/database.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today, plain] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/repeating-to-dos/seed.ts <store-path> <today> [plain] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, title: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
const reference = (id: string, taskId: string, title: string) => ({ id, type: 'task', props: { taskId, role: 'reference', planDate: '' }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
const para = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const tomorrow = addDays(today, 1)
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
void editorSeed
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify([line('a', 'Weekly review'), line('b', 'Water the plants'), line('c', 'Take the bins out'), line('d', 'Book the dentist'), line('e', 'Reply about the offsite'), line('f', 'Send the signed lease form back to the landlord before the end of the month'), para('p', 'Last line')]), today })
const id = (title: string) => ws.tasks.find(t => t.title.startsWith(title))!.id
await run({ type: 'ensure-day', date: tomorrow })
const next = ws.pages.find(p => p.id === `day:${tomorrow}`)!
await run({ type: 'save-editor', pageId: next.id, expectedContent: pageContentKey(next), document: JSON.stringify([reference('ref-c', id('Take the bins out'), 'Take the bins out'), para('tp', 'Tomorrow notes')]), today })
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(x => x.id === 'notes')!), document: JSON.stringify([reference('ref-a', id('Weekly review'), 'Weekly review')]), today })
await run({ type: 'create-document', title: 'Lists', body: '', pageId: 'lists' })
await run({ type: 'save-editor', pageId: 'lists', expectedContent: pageContentKey(ws.pages.find(x => x.id === 'lists')!), document: JSON.stringify([{ id: 'todos', type: 'database', props: { pageId: 'source:tasks', view: '' }, children: [] }]), today })
await run({ type: 'set-task-dates', taskId: id('Book the dentist'), deadlineOn: addDays(today, 3) })
if (plain !== 'plain') {
  const at = new Date().toISOString(), weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  await run({ type: 'set-todo-repeat', taskId: id('Weekly review'), repeat: { every: 'week', interval: 1, from: 'schedule' }, today, at })
  await run({ type: 'set-todo-repeat', taskId: id('Water the plants'), repeat: { every: 'day', interval: 5, from: 'done' }, today, at })
  await run({ type: 'set-todo-repeat', taskId: id('Take the bins out'), repeat: { every: 'day', interval: 1, from: 'schedule' }, today, at })
  await run({ type: 'set-todo-repeat', taskId: id('Send the signed lease form'), repeat: { every: 'week', interval: 2, from: 'schedule', weekdays: [weekday, (weekday + 3) % 7] }, today, at })
}
console.log('seeded', path)
