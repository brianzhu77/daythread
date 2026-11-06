// A disposable store for to-do links (todo-dependency.md): today's page with five to-dos, Alpha blocked by Bravo, Charlie by Alpha and Delta,
// and a long one, Echo, blocked by a to-do with long words.
// Usage: node --no-warnings tests/evidence/todo-dependency/seed.ts <store-path> <today>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/todo-dependency/seed.ts <store-path> <today> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const line = (id: string, title: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
const para = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
void editorSeed
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify([line('a', 'Alpha'), line('b', 'Bravo'), line('c', 'Charlie'), line('d', 'Delta'), line('e', 'Echo'), line('f', 'Send the signed lease form back to the landlord before the end of the month'), para('p', 'Last line')]), today })
const id = (title: string) => ws.tasks.find(t => t.title.startsWith(title))!.id
const at = new Date().toISOString()
await run({ type: 'link-tasks', taskId: id('Alpha'), add: [id('Bravo')], remove: [], at })
await run({ type: 'link-tasks', taskId: id('Charlie'), add: [id('Alpha'), id('Delta')], remove: [], at })
await run({ type: 'link-tasks', taskId: id('Echo'), add: [id('Send')], remove: [], at })
console.log('seeded', path)
