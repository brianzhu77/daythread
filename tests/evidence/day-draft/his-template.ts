// Makes the day pages' default template the shape of Brian's Day template (docs/plan/day-prep-draft.md, Facts), on a
// COPY of a SQLite store, so "more open" placement can be checked on his layout. Neutral words where his are private.
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<copy> node tests/evidence/day-draft/his-template.ts
import { resolve } from 'node:path'
import { getRepository } from '../../../src/server/storage.ts'
import { pageContentKey, textRun, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const path = process.env.DAYTHREAD_SQLITE_PATH
if (process.env.DAYTHREAD_STORAGE !== 'sqlite' || !path || resolve(path).split('/').includes('.daythread-local')) { console.error('Run on a SQLite copy.'); process.exit(2) }
const repository = getRepository()
const run = async (action: Action): Promise<Workspace> => {
  const { revision } = await repository.load()
  return (await repository.execute({ operationId: `his-template:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const id = () => crypto.randomUUID()
const h = (t: string, level: number): EditorNode => ({ id: id(), type: 'heading', props: { level }, content: [textRun(t)], children: [] })
const quote = (t: string): EditorNode => ({ id: id(), type: 'quote', props: {}, content: [textRun(t)], children: [] })
const slot = (): EditorNode => { const i = id(); return { id: i, type: 'task', props: { taskId: `editor-task:${i}`, role: 'reference', planDate: '' }, content: [], children: [] } }
const bullet = (): EditorNode => ({ id: id(), type: 'bulletListItem', props: {}, content: [], children: [] })
const para = (): EditorNode => ({ id: id(), type: 'paragraph', props: {}, content: [], children: [] })
const divider = (): EditorNode => ({ id: id(), type: 'divider', props: {}, children: [] })
const doc: EditorNode[] = [
  h('Morning Planning', 1),
  h('Events', 3), bullet(),
  h('Top 3', 3), quote('Finishable today.'), slot(), slot(), slot(),
  h('Other - Outside the Tunnel', 3), slot(),
  h('Intentional Drop / Slack', 3), para(),
  divider(),
  h('Raw Notes', 1), para(), h('Inspiration', 3), bullet(),
  divider(),
  h('Daily Reflection', 1), h('Progress', 3), quote('What moved forward?'), para(), h('Tunnel Check', 3), quote('Did I stay in the tunnel?'), para(),
  h("Tomorrow's Todo", 3), slot(),
]
const pageId = id()
let ws = await run({ type: 'create-template', title: 'Day', pageId, dayPage: true })
const page = ws.pages.find(p => p.id === pageId)!
ws = await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(doc), today: new Date().toLocaleDateString('en-CA') } as Action)
console.log('template', pageId, 'default for', ws.pages.find(p => p.id === pageId)?.parentId)
