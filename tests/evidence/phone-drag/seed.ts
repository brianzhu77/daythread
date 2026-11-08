// A disposable store for phone drags: today's page with two sections, a nested line and a to-do.
// Usage: node --no-warnings tests/evidence/phone-drag/seed.ts <store-path> <today>  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/phone-drag/seed.ts <store-path> <today>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const line = (id: string, t: string, children: EditorNode[] = []): EditorNode => ({ id, type: 'paragraph', props: {}, content: text(t), children })
const heading = (id: string, t: string): EditorNode => ({ id, type: 'heading', props: { level: 2 }, content: text(t), children: [] })
const task = (id: string, t: string): EditorNode => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: today }, content: text(t), children: [] })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), today, document: JSON.stringify([
  heading('ha', 'Morning'), line('a1', 'Alpha one'), line('a2', 'Alpha two'), line('a3', 'Alpha three'),
  heading('hb', 'Evening'), line('b1', 'Bravo one'), line('b2', 'Bravo two', [line('b21', 'Bravo two inner')]), task('t1', 'Call the bank'),
  line('p', 'Parent', [line('c1', 'Child one', [line('g1', 'Grandchild one', [line('d1', 'Deep one'), line('d2', 'Deep two')]), line('g2', 'Grandchild two')])]),
  ...Array.from({ length: 14 }, (_, i) => line(`z${i}`, `Filler line ${i}`)),
]) })
console.log('seeded', today)
