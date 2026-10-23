import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, carryAncestor, carrySection, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B34a (Jazz rule 3, Lead cbbabf88): Top 3 carries into Top 3, Other into Other, read from the row's section on the
// day it comes from. A nested row goes with its top-level ancestor's section (Bumblebee 8ea1b2fc, Lead 766387ae).
const yesterday = '2026-10-22', today = '2026-10-23'
function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { ws = applyCommand(ws, { operationId: `c-${++n}`, expectedRevision: ws.revision, action }).workspace; return ws }
  run({ type: 'ensure-day', date: yesterday })
  const page = () => ws.pages.find(p => p.date === yesterday)!
  const add = (title: string, kind: 'top3' | 'other') => { run({ type: 'add-task', pageId: page().id, sectionId: page().sections.find(s => s.kind === kind)!.id, title, plannedOn: yesterday }); return ws.tasks.at(-1)! }
  return { run, page, add, get ws() { return ws } }
}

test('a row in Top 3 carries to Top 3; a row in Other to Other; no row to Other', () => {
  const s = setup(), a = s.add('Top one', 'top3'), b = s.add('Other one', 'other')
  assert.equal(carrySection(s.page(), a.id), 'top3', 'a page never edited: its sections say it')
  assert.equal(carrySection(s.page(), b.id), 'other')
  assert.equal(carrySection(s.page(), 'missing'), 'other')
  assert.equal(carrySection(undefined, a.id), 'other')
})

test('a row dragged into Top 3 in the editor carries to Top 3, though its placement still says Other', () => {
  const s = setup(), t = s.add('Dragged up', 'other')
  const p = s.page(), doc = editorSeed(p, s.ws), row = doc.find(n => n.type === 'task')!
  const without = doc.filter(n => n.id !== row.id), at = without.findIndex(n => n.id === p.sections.find(x => x.kind === 'top3')!.id)
  s.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify([...without.slice(0, at + 1), row, ...without.slice(at + 1)]) })
  assert.equal(s.ws.placements.find(x => x.taskId === t.id)!.section, 'other')
  assert.equal(carrySection(s.page(), t.id), 'top3')
})

test('a sub-task under a Top 3 row carries into Top 3 with its parent (its top-level ancestor\'s section)', () => {
  const s = setup(), parent = s.add('Parent', 'top3'), child = s.add('Child', 'top3')
  const p = s.page(), doc = editorSeed(p, s.ws)
  const parentRow = doc.find(n => n.props?.taskId === parent.id)!, childRow = doc.find(n => n.props?.taskId === child.id)!
  const nested = doc.filter(n => n.id !== childRow.id).map(n => n.id === parentRow.id ? { ...n, children: [childRow] } : n) as EditorNode[]
  s.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(nested) })
  assert.equal(carrySection(s.page(), parent.id), 'top3')
  assert.equal(carrySection(s.page(), child.id), 'top3')
})

test('the morning card plans a Top 3 carry into today\'s Top 3 (plan-tasks), and a full Top 3 still falls back', () => {
  const s = setup(), tops = ['A', 'B', 'C', 'D'].map(t => s.add(t, 'top3'))
  s.run({ type: 'ensure-day', date: today })
  s.run({ type: 'plan-tasks', date: today, items: tops.map(t => ({ taskId: t.id, section: carrySection(s.page(), t.id) })) })
  const sections = tops.map(t => s.ws.placements.find(x => x.taskId === t.id && x.date === today)!.section)
  assert.deepEqual(sections, ['top3', 'top3', 'top3', 'other'])
})

test('A, B, b1, C: only top-level items count; b1 follows B into Top 3 and C still fits (Bumblebee df6f0a08, Lead 6999454f)', () => {
  const s = setup(), [a, b, b1, c] = ['A', 'B', 'b1', 'C'].map(t => s.add(t, 'top3'))
  const p = s.page(), doc = editorSeed(p, s.ws), rowB = doc.find(n => n.props?.taskId === b!.id)!, rowB1 = doc.find(n => n.props?.taskId === b1!.id)!
  s.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc.filter(n => n.id !== rowB1.id).map(n => n.id === rowB.id ? { ...n, children: [rowB1] } : n)) })
  assert.equal(carryAncestor(s.page(), b1!.id), b!.id)
  assert.equal(carryAncestor(s.page(), b!.id), null)
  s.run({ type: 'ensure-day', date: today })
  const items = [a, b, b1, c].map(t => ({ taskId: t!.id, section: carrySection(s.page(), t!.id), ...(carryAncestor(s.page(), t!.id) ? { follows: carryAncestor(s.page(), t!.id)! } : {}) }))
  s.run({ type: 'plan-tasks', date: today, items })
  const todayPage = s.ws.pages.find(x => x.date === today)!
  const rows = (k: string) => todayPage.sections.filter(x => x.kind === k).flatMap(x => x.blocks).filter(x => x.kind === 'task').map(x => x.text)
  assert.deepEqual(rows('top3'), ['A', 'B', 'b1', 'C'], 'A, B and C in Top 3, b1 right after B')
  assert.deepEqual(rows('other'), [], 'nothing dropped to Other')
})

test('a sub-task follows its parent to Other when the parent overflowed there', () => {
  const s = setup(), [x, y, z, parent, child] = ['X', 'Y', 'Z', 'Parent', 'Child'].map(t => s.add(t, 'top3'))
  const p = s.page(), doc = editorSeed(p, s.ws), rowP = doc.find(n => n.props?.taskId === parent!.id)!, rowC = doc.find(n => n.props?.taskId === child!.id)!
  s.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc.filter(n => n.id !== rowC.id).map(n => n.id === rowP.id ? { ...n, children: [rowC] } : n)) })
  s.run({ type: 'ensure-day', date: today })
  s.run({ type: 'plan-tasks', date: today, items: [x, y, z, parent, child].map(t => ({ taskId: t!.id, section: 'top3' as const, ...(t === child ? { follows: parent!.id } : {}) })) })
  const todayPage = s.ws.pages.find(q => q.date === today)!
  const rows = (k: string) => todayPage.sections.filter(q => q.kind === k).flatMap(q => q.blocks).filter(q => q.kind === 'task').map(q => q.text)
  assert.deepEqual(rows('top3'), ['X', 'Y', 'Z'])
  assert.deepEqual(rows('other'), ['Parent', 'Child'])
})
