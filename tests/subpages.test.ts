import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { tagIndex } from '../src/domain/tags.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// pages-delta N-2 step A: `/page` creates a child page and a page card at the cursor.
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action }).workspace
const day = () => run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
const dayPage = (ws: Workspace) => ws.pages.find(p => p.date === '2026-10-18')!
const card = (id: string, pageId: string): EditorNode => ({ id, type: 'pageLink', props: { pageId } })
function saveDay(ws: Workspace, edit: (doc: EditorNode[]) => EditorNode[]) {
  const p = dayPage(ws)
  return run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
}
function subpage(ws: Workspace, pageId = 'child') {
  ws = run(ws, { type: 'create-document', title: '', body: '', pageId, parentId: dayPage(ws).id })
  return saveDay(ws, doc => [...doc, card('card1', pageId)])
}

test('a subpage records the page it was made in (a day page too), starts empty and untitled', () => {
  const ws = subpage(day()), child = ws.pages.find(p => p.id === 'child')!
  assert.equal(child.parentId, dayPage(ws).id); assert.equal(child.type, 'document'); assert.equal(child.title, '')
  assert.deepEqual(child.sections.map(s => [s.id, s.title]), [['intro:child', '']])
  assert.equal(editorSeed(child, ws).some(n => n.type === 'heading'), false)
})

test('retrying the create under a new operation id finds the same page; a clash is refused', () => {
  let ws = day()
  ws = run(ws, { type: 'create-document', title: '', body: '', pageId: 'child', parentId: dayPage(ws).id })
  ws = run(ws, { type: 'create-document', title: '', body: '', pageId: 'child', parentId: dayPage(ws).id })
  assert.equal(ws.pages.filter(p => p.id === 'child').length, 1)
  assert.throws(() => run(ws, { type: 'create-document', title: '', body: '', pageId: 'child' }), /already in use/)
  assert.throws(() => run(ws, { type: 'create-document', title: '', body: '', pageId: dayPage(ws).id, parentId: 'child' }), /already in use/)
  assert.throws(() => run(ws, { type: 'create-document', title: '', body: '', pageId: 'other', parentId: 'missing' }))
})

test('Pages → New keeps its old shape: top level with a Notes heading', () => {
  const ws = run(createEmptyWorkspace(), { type: 'create-document', title: 'Trip ideas', body: '' })
  assert.equal(ws.pages[0]!.parentId, undefined); assert.equal(ws.pages[0]!.sections[0]!.title, 'Notes')
})

test('the card is stored as a reference to the page and seeds back as the same card', () => {
  const ws = subpage(day()), block = dayPage(ws).sections.flatMap(s => s.blocks).find(b => b.id === 'card1')!
  assert.equal(block.kind, 'reference'); assert.equal(block.targetPageId, 'child')
  assert.deepEqual(editorSeed(dayPage(ws), ws).find(n => n.id === 'card1'), card('card1', 'child'))
})

test('a reference saved before cards existed opens as a card', () => {
  let ws = day()
  ws = run(ws, { type: 'create-document', title: 'Old', body: '' })
  ws = run(ws, { type: 'insert-reference', pageId: dayPage(ws).id, sectionId: dayPage(ws).sections.at(-1)!.id, targetPageId: ws.pages.at(-1)!.id })
  const ref = dayPage(ws).sections.flatMap(s => s.blocks).find(b => b.kind === 'reference')!
  assert.deepEqual(editorSeed(dayPage(ws), ws).find(n => n.id === ref.id), card(ref.id, ws.pages.at(-1)!.id))
})

test('deleting the card leaves the page and its parent alone', () => {
  let ws = subpage(day())
  ws = saveDay(ws, doc => doc.filter(n => n.id !== 'card1'))
  const child = ws.pages.find(p => p.id === 'child')!
  assert.ok(child); assert.equal(child.parentId, dayPage(ws).id)
})

test('a page title with #tags or a task-like title neither adds tags nor touches tasks through the card', () => {
  let ws = subpage(day())
  ws = run(ws, { type: 'rename-page', pageId: 'child', title: 'Plan #work' })
  const tasks = structuredClone(ws.tasks)
  ws = saveDay(ws, doc => doc)
  assert.equal(tagIndex(ws).some(t => t.key === 'work'), false)
  assert.deepEqual(ws.tasks, tasks)
})

test('rename-page renames documents, keeps an empty title empty, and refuses day pages', () => {
  let ws = subpage(day())
  ws = run(ws, { type: 'rename-page', pageId: 'child', title: '  Trip  ideas ' })
  assert.equal(ws.pages.find(p => p.id === 'child')!.title, 'Trip  ideas')
  ws = run(ws, { type: 'rename-page', pageId: 'child', title: '' })
  assert.equal(ws.pages.find(p => p.id === 'child')!.title, '')
  assert.throws(() => run(ws, { type: 'rename-page', pageId: dayPage(ws).id, title: 'x' }), /date/)
})
