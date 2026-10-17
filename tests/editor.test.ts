import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, needsTemplateRows, pageContentKey, sectionRange } from '../src/domain/editor-document.ts'
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
test('a section owns its empty lines, including at the end of the document', () => {
  const list = [{ id: 'a', type: 'heading', props: { level: 2 } }, { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { id: 'gap', type: 'paragraph', content: [] }, { id: 'b', type: 'heading', props: { level: 2 } }, { id: 'blank', type: 'paragraph', content: [] }]
  assert.deepEqual(sectionRange(list, 'a').map(x => x.id), ['a', 'p', 'gap'])
  assert.deepEqual(sectionRange(list, 'b').map(x => x.id), ['b', 'blank'])
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

test('a new day page opens with the template rows, carried tasks sit above them, and empty rows create no task', () => {
  let ws = fixture(); const p = ws.pages[0]!
  assert.equal(needsTemplateRows(p, p.date!), true)
  const doc = editorSeed(p, ws, { templateRows: true })
  assert.deepEqual(doc.map(n => n.type), ['heading', 'task', 'task', 'heading', 'task', 'heading', 'bulletListItem', 'heading', 'bulletListItem', 'heading', 'bulletListItem'])
  assert.equal(doc[1]!.props?.taskId, ws.tasks[0]!.id)
  assert.equal(doc[2]!.props?.taskId, `editor-task:${doc[2]!.id}`)
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  assert.equal(ws.tasks.length, 1)
  assert.equal(ws.pages[0]!.templateApplied, true)
  assert.equal(needsTemplateRows(ws.pages[0]!, p.date!), false)
})
test('template rows the user deletes stay deleted, and past or written pages never get them', () => {
  let ws = fixture(); const p = ws.pages[0]!
  const withoutRows = editorSeed(p, ws, { templateRows: true }).filter(n => !n.id.includes(':template:'))
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(withoutRows) })
  const saved = ws.pages[0]!
  assert.equal(needsTemplateRows(saved, saved.date!), false)
  assert.equal(editorSeed(saved, ws).some(n => n.id.includes(':template:')), false)
  assert.equal(needsTemplateRows(p, '2026-10-17'), false)
  const legacy = { ...saved, templateApplied: undefined }
  assert.equal(needsTemplateRows(legacy, saved.date!), false)
})
test('moving the last template section takes its empty line with it', () => {
  const ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' }); const p = ws.pages[0]!
  const doc = editorSeed(p, ws, { templateRows: true })
  const notes = p.sections.find(s => s.kind === 'notes')!.id
  assert.deepEqual(sectionRange(doc, notes).map(n => n.id), [notes, `${notes}:template:0`])
})
test('tasks placed on a day go above the section\'s trailing empty rows', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' }); const p = ws.pages[0]!
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(editorSeed(p, ws, { templateRows: true })) })
  const other = ws.pages[0]!.sections.find(s => s.kind === 'other')!
  ws = run(ws, { type: 'add-task', pageId: p.id, sectionId: other.id, title: 'Reply to landlord' })
  const blocks = ws.pages[0]!.sections.find(s => s.kind === 'other')!.blocks
  assert.deepEqual(blocks.map(b => b.text), ['Reply to landlord', ''])
})
test('an image at the end of a section is content, so new rows go after it', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' }); const p = ws.pages[0]!
  const notes = p.sections.find(s => s.kind === 'notes')!
  const doc = [...editorSeed(p, ws), { id: 'img', type: 'image', props: { url: 'https://example.com/a.png' } }]
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  ws = run(ws, { type: 'add-text', pageId: p.id, sectionId: notes.id, text: 'After the picture' })
  assert.deepEqual(ws.pages[0]!.sections.find(s => s.kind === 'notes')!.blocks.map(b => b.id === 'img' ? 'img' : b.text), ['img', 'After the picture'])
})
test('text added to Notes goes above its empty template bullet', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' }); const p = ws.pages[0]!
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(editorSeed(p, ws, { templateRows: true })) })
  const notes = ws.pages[0]!.sections.find(s => s.kind === 'notes')!
  ws = run(ws, { type: 'add-text', pageId: p.id, sectionId: notes.id, text: 'Captured thought' })
  assert.deepEqual(ws.pages[0]!.sections.find(s => s.kind === 'notes')!.blocks.map(b => b.text), ['Captured thought', ''])
})
