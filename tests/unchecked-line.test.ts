import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B42 (Lead, Brian): a line that stops being a to-do counts as deleting it. A task born on the page is deleted (⌘Z /
// Undo bring the same task back); a task with history goes to Not today; turning it back into a to-do by hand makes a
// new task.
const today = '2026-10-23', yesterday = '2026-10-22'
function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action, operationId = `u-${++n}`) => { ws = applyCommand(ws, { operationId, expectedRevision: ws.revision, action }).workspace; return ws }
  const page = (date = today) => ws.pages.find(p => p.date === date)!
  run({ type: 'ensure-day', date: today })
  const add = (title: string, date = today) => {
    run({ type: 'ensure-day', date })
    run({ type: 'add-task', pageId: page(date).id, sectionId: page(date).sections.find(s => s.kind === 'other')!.id, title, plannedOn: date })
    return ws.tasks.at(-1)!
  }
  const doc = () => editorSeed(page(), ws)
  const save = (edit: (nodes: EditorNode[]) => EditorNode[], extra: Partial<Extract<Action, { type: 'save-editor' }>> = {}, operationId?: string) =>
    run({ type: 'save-editor', pageId: page().id, expectedContent: pageContentKey(page()), document: JSON.stringify(edit(doc())), today, ...extra }, operationId)
  const rowOf = (taskId: string) => { const find = (l: EditorNode[]): EditorNode | undefined => { for (const x of l) { if (x.props?.taskId === taskId) return x; const c = find(x.children ?? []); if (c) return c } }; return find(doc())! }
  /** The same block, now another kind of line (its words kept). */
  const as = (type: string, props: Record<string, unknown> = {}) => (x: EditorNode): EditorNode => ({ id: x.id, type, props, content: x.content, children: x.children ?? [] })
  const map = (nodes: EditorNode[], id: string, f: (x: EditorNode) => EditorNode): EditorNode[] => nodes.map(x => x.id === id ? f(x) : { ...x, children: map(x.children ?? [], id, f) })
  return { run, page, add, doc, save, rowOf, as, map, get ws() { return ws } }
}
const has = (ws: Workspace, id: string) => ws.tasks.some(t => t.id === id)

test('a to-do born here turned into a bullet, text or a heading: its task goes, and its placement', () => {
  for (const [type, props] of [['bulletListItem', {}], ['paragraph', {}], ['heading', { level: 3 }], ['numberedListItem', {}]] as const) {
    const s = setup(), t = s.add('Delete task when I delete the checkbox'), row = s.rowOf(t.id).id
    s.save(nodes => s.map(nodes, row, s.as(type, props)))
    assert.equal(has(s.ws, t.id), false, type)
    assert.equal(s.ws.placements.some(x => x.taskId === t.id), false, `${type}: no "Not today" count left`)
    assert.ok(JSON.stringify(s.page().editorJSON).includes('Delete task when I delete the checkbox'), `${type}: the words stay on the page`)
  }
})

test('⌘Z brings back the same task (done state and placement); the next ordinary save doesn\'t', () => {
  const s = setup(), t = s.add('read SEO information')
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today })
  const before = structuredClone(s.ws.tasks.find(x => x.id === t.id)!), row = s.rowOf(t.id), asTask = structuredClone(row)
  s.save(nodes => s.map(nodes, row.id, s.as('bulletListItem')))
  // An ordinary save later (more typing on the bullet) leaves the task gone.
  s.save(nodes => s.map(nodes, row.id, x => ({ ...x, content: [{ type: 'text', text: 'read SEO information, later', styles: {} }] })))
  assert.equal(has(s.ws, t.id), false, 'the bullet being there doesn\'t bring the task back')
  // ⌘Z: the editor puts the to-do row back on the same block (a history save).
  s.save(nodes => s.map(nodes, row.id, () => asTask), { history: true, historyTaskVersions: { [t.id]: 0 } })
  assert.deepEqual(s.ws.tasks.find(x => x.id === t.id), before)
  assert.equal(s.ws.placements.some(x => x.taskId === t.id && x.date === today), true)
})

test('Undo (the notice or the app) of the conversion brings it back too', () => {
  const s = setup(), t = s.add('Write report'), row = s.rowOf(t.id).id
  s.save(nodes => s.map(nodes, row, s.as('bulletListItem')), {}, 'convert')
  s.run({ type: 'undo', targetOperationId: 'convert' })
  assert.equal(has(s.ws, t.id), true)
})

test('a to-do with history goes to Not today, as with a delete', () => {
  const s = setup(), carried = s.add('From yesterday', yesterday)
  s.run({ type: 'plan-task', taskId: carried.id, date: today, section: 'other', from: yesterday, today })
  const row = s.rowOf(carried.id).id
  s.save(nodes => s.map(nodes, row, s.as('bulletListItem')))
  const t = s.ws.tasks.find(x => x.id === carried.id)!
  assert.equal(t.paused, true, 'Not today')
  assert.equal(t.plannedOn, null)
})

test('a nested to-do turned into a bullet: the child\'s task goes, the parent\'s stays (Bumblebee)', () => {
  const s = setup(), parent = s.add('#daythread bug'), child = s.add('Delete task when I delete the checkbox')
  const p = s.rowOf(parent.id), c = s.rowOf(child.id)
  s.save(nodes => nodes.filter(x => x.id !== c.id).map(x => x.id === p.id ? { ...x, children: [c] } : x))
  s.save(nodes => s.map(nodes, c.id, s.as('bulletListItem')))
  assert.equal(has(s.ws, child.id), false)
  assert.equal(has(s.ws, parent.id), true)
  assert.equal(s.ws.tasks.find(x => x.id === parent.id)!.plannedOn, today)
})

test('several lines at once (a selection turned into bullets): each counts on its own', () => {
  const s = setup(), a = s.add('a one'), b = s.add('a two'), carried = s.add('carried', yesterday)
  s.run({ type: 'plan-task', taskId: carried.id, date: today, section: 'other', from: yesterday, today })
  const ids = [a, b, carried].map(t => s.rowOf(t.id).id)
  s.save(nodes => ids.reduce((acc, id) => s.map(acc, id, s.as('bulletListItem')), nodes))
  assert.equal(has(s.ws, a.id) || has(s.ws, b.id), false)
  assert.equal(s.ws.tasks.find(x => x.id === carried.id)!.paused, true)
})

test('turning the line back into a to-do by hand makes a new task; the old one stays gone', () => {
  const s = setup(), t = s.add('Call mom'), row = s.rowOf(t.id).id
  s.save(nodes => s.map(nodes, row, s.as('bulletListItem')))
  s.save(nodes => s.map(nodes, row, x => ({ ...x, type: 'task', props: { taskId: `editor-task:${x.id}`, role: 'plan', planDate: today } })))
  assert.equal(has(s.ws, t.id), false)
  const fresh = s.ws.tasks.find(x => x.id === `editor-task:${row}`)
  assert.equal(fresh?.title, 'Call mom')
  assert.notEqual(fresh?.id, t.id)
})

test('a text line turned into a to-do makes a task (it used to be refused as "Unknown Task identity")', () => {
  const s = setup()
  s.save(nodes => [...nodes, { id: 'note', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'buy milk', styles: {} }], children: [] }])
  s.save(nodes => s.map(nodes, 'note', x => ({ ...x, type: 'task', props: { taskId: 'editor-task:note', role: 'plan', planDate: today } })))
  assert.equal(s.ws.tasks.find(x => x.id === 'editor-task:note')?.title, 'buy milk')
})

test('not a conversion: another line of the same task stays on the page, or the line is cut', () => {
  const s = setup(), t = s.add('Twice here'), row = s.rowOf(t.id)
  s.save(nodes => [...nodes, { ...structuredClone(row), id: 'copy', props: { ...row.props, role: 'reference' } }])
  s.save(nodes => s.map(nodes, row.id, s.as('bulletListItem')))
  assert.equal(has(s.ws, t.id), true, 'its other line is still a to-do')
  const u = s.add('Cut me'), r2 = s.rowOf(u.id).id
  s.save(nodes => s.map(nodes, r2, s.as('bulletListItem')), { cutTaskIds: [u.id] })
  assert.equal(has(s.ws, u.id), true, 'a cut is a move (B33)')
})

test('a block that held another kind of row never becomes a new task in place', () => {
  const s = setup(), t = s.add('Task row'), row = s.rowOf(t.id).id
  assert.throws(() => s.save(nodes => s.map(nodes, row, x => ({ ...x, props: { ...x.props, taskId: `editor-task:${x.id}` } }))), /Unknown Task identity/)
})

test('a to-do typed in the editor, done, unchecked, then made a to-do again by hand: a new open task, not the old one (Ratchet 564e2144)', () => {
  const s = setup()
  s.save(nodes => [...nodes, { id: 'typed', type: 'task', props: { taskId: 'editor-task:typed', role: 'plan', planDate: today }, content: [{ type: 'text', text: 'Typed here', styles: {} }], children: [] }])
  s.run({ type: 'task-status', taskId: 'editor-task:typed', status: 'done', today })
  const asTask = structuredClone(s.rowOf('editor-task:typed'))
  s.save(nodes => s.map(nodes, 'typed', s.as('bulletListItem')))
  assert.equal(has(s.ws, 'editor-task:typed'), false)
  // By hand (a plain save): a new task on the same block, open, not the old done one.
  s.save(nodes => s.map(nodes, 'typed', () => ({ ...asTask, props: { ...asTask.props, taskId: 'editor-task:typed' } })))
  const t = s.ws.tasks.find(x => x.id === 'editor-task:typed')!
  assert.equal(t.status, 'open', 'a fresh task')
  assert.equal(s.page().editorDeletions?.typed, undefined, 'the old one can\'t come back later')
})

test('the same row brought back by ⌘Z (a history save) restores the old task, done state included', () => {
  const s = setup()
  s.save(nodes => [...nodes, { id: 'typed', type: 'task', props: { taskId: 'editor-task:typed', role: 'plan', planDate: today }, content: [{ type: 'text', text: 'Typed here', styles: {} }], children: [] }])
  s.run({ type: 'task-status', taskId: 'editor-task:typed', status: 'done', today })
  const asTask = structuredClone(s.rowOf('editor-task:typed'))
  s.save(nodes => s.map(nodes, 'typed', s.as('bulletListItem')))
  s.save(nodes => s.map(nodes, 'typed', () => asTask), { history: true, historyTaskVersions: { 'editor-task:typed': 0 } })
  assert.equal(s.ws.tasks.find(x => x.id === 'editor-task:typed')?.status, 'done')
})
