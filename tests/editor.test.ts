import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, sectionRange } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
function run(ws: Workspace, action: Action) { return applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace }
function fixture() {
 let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' })
 ws = run(ws, { type: 'add-task', pageId: ws.pages[0]!.id, sectionId: ws.pages[0]!.sections[0]!.id, title: 'Existing task' })
 return ws
}
test('section boundary includes subordinate headings but stops at equal or higher headings', () => {
 const list = [{ id: 'intro', type: 'paragraph' }, { id: 'a', type: 'heading', props: { level: 2 } }, { id: 'child', type: 'heading', props: { level: 3 } }, { id: 'p', type: 'paragraph' }, { id: 'b', type: 'heading', props: { level: 2 } }]
 assert.deepEqual(sectionRange(list, 'a').map(x => x.id), ['a', 'child', 'p'])
})
test('the last section leaves the editor trailing empty paragraph in place but keeps its own blank lines', () => {
  const list = [{ id: 'a', type: 'heading', props: { level: 2 } }, { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { id: 'gap', type: 'paragraph', content: [] }, { id: 'q', type: 'paragraph', content: [{ type: 'text', text: 'y' }] }, { id: 'trail', type: 'paragraph', content: [] }]
  assert.deepEqual(sectionRange(list, 'a').map(x => x.id), ['a', 'p', 'gap', 'q'])
  const middle = [...list.slice(0, 3), { id: 'b', type: 'heading', props: { level: 2 } }]
  assert.deepEqual(sectionRange(middle, 'a').map(x => x.id), ['a', 'p', 'gap'])
})
test('whole section deletion and restoration preserve task and placement; moved rows keep their role', () => {
 let ws = fixture(); const p = ws.pages[0]!, doc = editorSeed(p, ws), beforeTask = structuredClone(ws.tasks), beforePlacement = structuredClone(ws.placements)
 const range = new Set(sectionRange(doc, p.sections[0]!.id).map(n => n.id))
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc.filter(n => !range.has(n.id))) })
 assert.deepEqual(ws.tasks, beforeTask); assert.deepEqual(ws.placements, beforePlacement)
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(ws.pages[0]!), document: JSON.stringify(doc) })
 assert.equal(ws.tasks.length, 1); assert.equal(ws.pages[0]!.sections[0]!.blocks[0]!.planRole, 'plan')
})
test('semantic single-row deletion and undo check task versions instead of rolling back later edits', () => {
 let ws = fixture(); const p = ws.pages[0]!, doc = editorSeed(p, ws), row = doc.find(n => n.type === 'task')!
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc.filter(n => n.id !== row.id)), singleDeleteIds: [row.id], today: p.date! })
 assert.equal(ws.tasks[0]!.paused, true)
 const beforeConflict = run(ws, { type: 'task-status', taskId: ws.tasks[0]!.id, status: 'done' })
 assert.throws(() => run(beforeConflict, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(beforeConflict.pages[0]!), document: JSON.stringify(doc) }), /cannot undo safely/)
 assert.equal(beforeConflict.tasks[0]!.status, 'done')
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(ws.pages[0]!), document: JSON.stringify(doc) })
 assert.equal(ws.tasks[0]!.paused, false); assert.equal(ws.tasks[0]!.plannedOn, p.date)
})
test('editor stale save rejects atomically and new custom tasks get stable identities', () => {
 let ws = fixture(); const p = ws.pages[0]!, key = pageContentKey(p), doc = editorSeed(p, ws)
 doc.push({ id: 'new', type: 'task', props: { taskId: 'editor-task:new', role: 'reference' }, content: 'An unplanned task' })
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: key, document: JSON.stringify(doc) })
 assert.equal(ws.tasks.length, 2); assert.equal(ws.tasks[1]!.plannedOn, null)
 assert.throws(() => run(ws, { type: 'save-editor', pageId: p.id, expectedContent: key, document: '[]' }), /changed elsewhere/)
 ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(ws.pages[0]!), document: JSON.stringify(doc) })
 assert.equal(ws.tasks.length, 2)
})

test('external checklists remain prose until conversion, and conversion history removes and restores only its new task', () => {
 let ws = fixture(); const p = ws.pages[0]!, doc = editorSeed(p, ws)
 const id = 'imported-checklist'
 doc.push({ id, type: 'sourceChecklist', props: { checked: false }, content: 'Call a new clinic' }, { id: 'done-import', type: 'sourceChecklist', props: { checked: true }, content: 'Already completed' })
 const save = (nodes: unknown[], history = false) => { ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(ws.pages[0]!), document: JSON.stringify(nodes), history }) }
 save(doc); assert.equal(ws.tasks.length, 1)
 const converted = doc.map(n => n.id === id ? { ...n, type: 'task', props: { taskId: `editor-task:${id}`, role: 'reference' } } : n)
 save(converted); assert.equal(ws.tasks.length, 2); assert.equal(ws.tasks[1]!.plannedOn, null)
 save(doc, true); assert.equal(ws.tasks.length, 1)
 save(converted, true); assert.equal(ws.tasks.length, 2); assert.equal(ws.tasks[1]!.id, `editor-task:${id}`)
 assert.equal(JSON.parse(ws.pages[0]!.editorJSON!).find((n: { id: string }) => n.id === 'done-import').props.checked, true)
 assert.ok(!ws.tasks.some(t => t.title === 'Already completed'))
 const bad = editorSeed(ws.pages[0]!, ws); bad.push({ id:'bad', type:'task',props:{ taskId:'foreign',role:'reference'},content:'Wrong identity' })
 assert.throws(() => save(bad), /Unknown Task identity/)
})
