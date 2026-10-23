// A11 browser check fixture (docs/plan/a11-line-links.md §8): adds the pages, lines, tasks and line links that
// ui-check.mjs exercises to a COPY of the database, through the commands the app sends. Refuses the live database.
//
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=/tmp/a11/w.sqlite node tests/evidence/a11/seed.ts
//
// Writes the ids it made to `<db>.a11.json` for ui-check.mjs. Run it once per copy (it refuses a second run).
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { getRepository } from '../../../src/server/storage.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const path = process.env.DAYTHREAD_SQLITE_PATH
if (!path) { console.error('Set DAYTHREAD_SQLITE_PATH to a copy of the database.'); process.exit(2) }
if (resolve(path).split('/').includes('.daythread-local')) { console.error(`Refusing ${resolve(path)}: run this on a copy.`); process.exit(2) }

const repository = getRepository()
const run = async (action: Action) => {
  const { revision } = await repository.load()
  return (await repository.execute({ operationId: `a11-fixture:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const today = iso(new Date()), past = iso(new Date(Date.now() - 4 * 86_400_000)), tomorrow = iso(new Date(Date.now() + 86_400_000))
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id || (p.type === 'daily' && p.date === id))!
const save = async (id: string, edit: (nodes: EditorNode[]) => EditorNode[]) => {
  const ws = await repository.load(), p = page(ws, id)
  return run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws, { templateRows: needsTemplateRows(p, today) }))), today })
}
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const para = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', props: {}, content, children: [] } as unknown as EditorNode)
const lineRef = (pageId: string, lineId: string, taskId = '') => ({ type: 'pageRef', props: { pageId, refId: crypto.randomUUID(), newTitle: '', lineId, taskId } })

if ((await repository.load()).pages.some(p => p.id === 'a11-source')) { console.error('This copy already has the A11 fixture; use a fresh copy.'); process.exit(1) }

// The target page: enough lines that a jump has somewhere to go, a long line, a custom heading, a line to cut, and
// one to drag.
const long = '原生家庭创伤导致的讨好型人格与边界感的建立过程，以及之后几年里慢慢学会说不的那些小事'
await run({ type: 'create-document', title: 'A11 target', body: '', pageId: 'a11-target' })
await save('a11-target', nodes => [
  ...nodes.filter(n => n.type === 'heading'),
  ...Array.from({ length: 30 }, (_, i) => para(`a11-fill-${i}`, text(`Filler line ${i + 1}`))),
  { id: 'a11-heading', type: 'heading', props: { level: 2 }, content: [text('Reading')], children: [] } as unknown as EditorNode,
  para('a11-line', text('The linked line')),
  para('a11-long', text(long)),
  para('a11-cut', text('A line to cut')),
  para('a11-drag', text('A line to drag')),
  ...Array.from({ length: 30 }, (_, i) => para(`a11-tail-${i}`, text(`Tail line ${i + 1}`))),
])
// A page whose linked line is deleted, and one that goes to the trash with its line.
await run({ type: 'create-document', title: 'A11 deleted', body: '', pageId: 'a11-gone' })
await save('a11-gone', nodes => [...nodes, para('a11-deleted', text('Soon deleted'))])
await save('a11-gone', nodes => nodes.filter(n => n.id !== 'a11-deleted'))
await run({ type: 'create-document', title: 'A11 trashed', body: '', pageId: 'a11-trash' })
await save('a11-trash', nodes => [...nodes, para('a11-trash-line', text('On a trashed page'))])

// Tasks: one made on a past day and brought to today (its history row stays there); one planned today, moved below.
let ws = await run({ type: 'ensure-day', date: past })
await run({ type: 'ensure-day', date: today }); await run({ type: 'ensure-day', date: tomorrow })
const other = (date: string, w: Workspace) => page(w, date).sections.find(s => s.kind === 'other')!.id
ws = await run({ type: 'add-task', pageId: page(ws, past).id, sectionId: other(past, ws), title: 'A11 past task', plannedOn: past })
const pastTask = ws.tasks.at(-1)!.id
const pastRow = page(ws, past).sections.flatMap(s => s.blocks).find(b => b.taskId === pastTask)!.id
ws = await run({ type: 'plan-task', taskId: pastTask, date: today, section: 'other', from: past, today })
const todayRow = page(ws, today).sections.flatMap(s => s.blocks).find(b => b.taskId === pastTask)!.id
ws = await run({ type: 'add-task', pageId: page(ws, today).id, sectionId: other(today, ws), title: 'A11 moving task', plannedOn: today })
const movingTask = ws.tasks.at(-1)!.id
const movingRow = page(ws, today).sections.flatMap(s => s.blocks).find(b => b.taskId === movingTask)!.id

// A page that is removed outright below (only a link paste's Undo does that in the app), for "Page not found".
await run({ type: 'create-document', title: 'A11 missing', body: '', pageId: 'a11-missing' })

// A trashed document page holding a row of the task planned today: its URL still follows the task (Ratchet #146).
await run({ type: 'create-document', title: 'A11 trashed task page', body: '', pageId: 'a11-trash-task' })
await save('a11-trash-task', nodes => [...nodes, { id: 'a11-trashed-task-row', type: 'task', props: { taskId: pastTask }, content: [text('A11 past task')], children: [] } as unknown as EditorNode])
await run({ type: 'delete-page', pageId: 'a11-trash-task', at: new Date().toISOString() })

// A tagged task (planned today) with a row on the target page, and a second row of it there that's then removed:
// a tag opens the page the Tags list names; a row that's gone follows its task (Bumblebee 54096b19).
ws = await run({ type: 'add-task', pageId: page(ws, today).id, sectionId: other(today, ws), title: 'A11 tagged task #a11tag', plannedOn: today })
const taggedTask = ws.tasks.at(-1)!.id
await save('a11-target', nodes => { const at = nodes.findIndex(n => n.id === 'a11-tail-0'); return [...nodes.slice(0, at), { id: 'a11-tagged-row', type: 'task', props: { taskId: taggedTask }, content: [text('A11 tagged task #a11tag')], children: [] } as unknown as EditorNode,
  { id: 'a11-tagged-gone', type: 'task', props: { taskId: taggedTask }, content: [text('A11 tagged task #a11tag')], children: [] } as unknown as EditorNode, ...nodes.slice(at)] })
await save('a11-target', nodes => nodes.filter(n => n.id !== 'a11-tagged-gone'))
ws = await repository.load()
const taggedTodayRow = page(ws, today).sections.flatMap(s => s.blocks).find(b => b.taskId === taggedTask)!.id

// The page holding the links, and a page link to the target too (Linked from lists the source once).
await run({ type: 'create-document', title: 'A11 links', body: '', pageId: 'a11-source' })
ws = await repository.load()
const links = {
  line: lineRef('a11-target', 'a11-line'), long: lineRef('a11-target', 'a11-long'), heading: lineRef('a11-target', 'a11-heading'),
  cut: lineRef('a11-target', 'a11-cut'), drag: lineRef('a11-target', 'a11-drag'), deleted: lineRef('a11-gone', 'a11-deleted'),
  trashed: lineRef('a11-trash', 'a11-trash-line'), missing: lineRef('a11-missing', 'a11-nothing'),
  pastTask: lineRef(page(ws, past).id, pastRow, pastTask), moving: lineRef(page(ws, today).id, movingRow, movingTask),
}
await save('a11-source', nodes => [
  ...nodes.filter(n => n.type === 'heading'),
  ...Object.entries(links).map(([name, ref]) => para(`a11-src-${name}`, text(`${name}: `), ref)),
  para('a11-src-page', text('page: '), { type: 'pageRef', props: { pageId: 'a11-target', refId: crypto.randomUUID(), newTitle: '' } }),
  para('a11-src-empty'),
])
await run({ type: 'delete-page', pageId: 'a11-trash', at: new Date().toISOString() })
ws = await run({ type: 'plan-task', taskId: movingTask, date: tomorrow, section: 'other', from: today, today })

const manifest = {
  today, past, tomorrow, long,
  pages: { target: 'a11-target', source: 'a11-source', gone: 'a11-gone', trash: 'a11-trash', past: page(ws, past).id, today: page(ws, today).id, tomorrow: page(ws, tomorrow).id },
  tasks: { past: pastTask, moving: movingTask, tagged: taggedTask },
  rows: { pastRow, todayRow, movingRow, taggedTodayRow, movedRow: page(ws, tomorrow).sections.flatMap(s => s.blocks).find(b => b.taskId === movingTask)!.id },
  refIds: Object.fromEntries(Object.entries(links).map(([name, ref]) => [name, ref.props.refId])),
}
// Remove 'a11-missing' from the store directly (both snapshots), as an outright delete leaves it: links to it stay.
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(path)
try { db.prepare("DELETE FROM pages WHERE id = 'a11-missing'").run() } finally { db.close() }
writeFileSync(`${path}.a11.json`, JSON.stringify(manifest, null, 2))
console.log(`A11 fixture added (today ${today}, past ${past}, tomorrow ${tomorrow}); ids in ${path}.a11.json`)
