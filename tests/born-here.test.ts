import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, deletesWithLine } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B33 (Jazz rule 2, Lead 764c7bf8, cut fallback ad9ce400): a task born on its page with no history goes with its
// line, by any delete; ⌘Z / Undo brings it back with the same id. A task with history keeps Not today.
const today = '2026-10-23', yesterday = '2026-10-22', later = '2026-10-30'

function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action, operationId = `b33-${++n}`) => { ws = applyCommand(ws, { operationId, expectedRevision: ws.revision, action }).workspace; return ws }
  const page = (date: string) => ws.pages.find(p => p.date === date)!
  const day = (date: string) => { run({ type: 'ensure-day', date }); return page(date) }
  const add = (title: string, extra: Partial<Extract<Action, { type: 'add-task' }>> = {}, date = today) => {
    const p = day(date)
    run({ type: 'add-task', pageId: p.id, sectionId: p.sections.find(s => s.kind === 'other')!.id, title, plannedOn: date, ...extra })
    return ws.tasks.at(-1)!
  }
  const rowOf = (taskId: string, date = today) => page(date).sections.flatMap(s => s.blocks).find(b => b.taskId === taskId)!
  const save = (date: string, edit: (nodes: EditorNode[]) => EditorNode[], extra: Partial<Extract<Action, { type: 'save-editor' }>> = {}, operationId?: string) => {
    const p = page(date)
    return run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))), today, ...extra }, operationId)
  }
  return { run, page, day, add, rowOf, save, get ws() { return ws } }
}
const has = (ws: Workspace, id: string) => ws.tasks.some(t => t.id === id)

test('a task born here goes with its line: one row, a block selection, a section', () => {
  const s = setup(), a = s.add('a'), b = s.add('Write report'), c = s.add('Call dentist')
  // One row, by its key (singleDeleteIds), as Backspace on an empty row sends it.
  const rowA = s.rowOf(a.id).id
  s.save(today, nodes => nodes.filter(n => n.id !== rowA), { singleDeleteIds: [rowA] })
  assert.equal(has(s.ws, a.id), false)
  assert.equal(s.ws.placements.some(x => x.taskId === a.id), false, 'its placement goes too, so no "Not today" count')
  assert.equal(s.page(today).editorDeletions?.[rowA]?.deleted, true)
  // Two rows by a block selection (no semantic ids).
  const rows = new Set([s.rowOf(b.id).id, s.rowOf(c.id).id])
  s.save(today, nodes => nodes.filter(n => !rows.has(n.id)))
  assert.equal(has(s.ws, b.id) || has(s.ws, c.id), false)
})

test('a whole section deleted: born-here tasks go, a task with history stays planned', () => {
  const s = setup(), born = s.add('Born here'), kept = s.add('Has a deadline', { deadlineOn: later })
  const other = s.page(today).sections.find(x => x.kind === 'other')!.id
  s.save(today, nodes => { const at = nodes.findIndex(n => n.id === other); const next = nodes.findIndex((n, i) => i > at && n.type === 'heading'); return [...nodes.slice(0, at), ...nodes.slice(next)] })
  assert.equal(has(s.ws, born.id), false)
  assert.equal(s.ws.tasks.find(t => t.id === kept.id)?.plannedOn, today, 'history: stays planned ("Planned · not in note")')
})

test('history keeps today\'s rule: a deadline, another day, a start date', () => {
  const s = setup()
  const deadline = s.add('Deadline', { deadlineOn: later })
  const carried = s.add('From yesterday', {}, yesterday)
  s.day(today); s.run({ type: 'plan-task', taskId: carried.id, date: today, section: 'other', from: yesterday, today })
  for (const t of [deadline, carried]) {
    const row = s.rowOf(t.id).id
    s.save(today, nodes => nodes.filter(n => n.id !== row), { singleDeleteIds: [row] })
    assert.equal(has(s.ws, t.id), true, t.title)
    assert.equal(s.ws.tasks.find(x => x.id === t.id)!.paused, true, `${t.title}: Not today`)
  }
})

test('a blank title always counts as born here, even with history', () => {
  const s = setup(), t = s.add('#', { deadlineOn: later })
  const row = s.rowOf(t.id).id
  s.save(today, nodes => nodes.filter(n => n.id !== row), { singleDeleteIds: [row] })
  assert.equal(has(s.ws, t.id), false)
})

test('not a delete: typing the text away, a row still elsewhere, a move on the page, a cut', () => {
  const s = setup()
  const typed = s.add('Typed away'), row = s.rowOf(typed.id).id
  s.save(today, nodes => nodes.map(n => n.id === row ? { ...n, content: '' } : n))
  assert.equal(has(s.ws, typed.id), true, 'the row stays: the same task')
  const elsewhere = s.add('Also on a document')
  s.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' })
  const doc = s.ws.pages.find(p => p.id === 'doc')!
  s.run({ type: 'save-editor', pageId: 'doc', expectedContent: pageContentKey(doc), document: JSON.stringify([...editorSeed(doc, s.ws), { id: 'ref-row', type: 'task', props: { taskId: elsewhere.id }, content: 'Also on a document' }]) })
  const r2 = s.rowOf(elsewhere.id).id
  s.save(today, nodes => nodes.filter(n => n.id !== r2), { singleDeleteIds: [r2] })
  assert.equal(has(s.ws, elsewhere.id), true, 'it still has a line on another page')
  const moved = s.add('Moved'), r3 = s.rowOf(moved.id).id
  s.save(today, nodes => nodes.map(n => n.id === r3 ? { ...n, id: 'moved-row' } : n))
  assert.equal(has(s.ws, moved.id), true, 'same task under a new row id on the page')
  const cut = s.add('Cut to move'), r4 = s.rowOf(cut.id).id
  s.save(today, nodes => nodes.filter(n => n.id !== r4), { cutTaskIds: [cut.id] })
  assert.equal(has(s.ws, cut.id), true, 'a cut never deletes (Jazz fallback)')
})

test('⌘Z brings it back with the same id, done state and placement; so does Undo', () => {
  const s = setup(), t = s.add('Done then deleted')
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today })
  const before = structuredClone(s.ws.tasks.find(x => x.id === t.id)!), placements = structuredClone(s.ws.placements.filter(x => x.taskId === t.id))
  const doc = editorSeed(s.page(today), s.ws), row = s.rowOf(t.id).id
  s.save(today, nodes => nodes.filter(n => n.id !== row), { singleDeleteIds: [row] }, 'delete-op')
  assert.equal(has(s.ws, t.id), false)
  // ⌘Z: the editor puts the row back (a history save with the same document as before).
  const p = s.page(today)
  s.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc), today, history: true, historyTaskVersions: { [t.id]: 0 } })
  assert.deepEqual(s.ws.tasks.find(x => x.id === t.id), before)
  const plain = (list: typeof placements) => list.map(({ order: _order, ...x }) => x)
  assert.deepEqual(plain(s.ws.placements.filter(x => x.taskId === t.id)), plain(placements))
  assert.equal(s.page(today).editorDeletions?.[row], undefined)
  // Undo (the notice / app Undo) of a delete brings it back too.
  s.save(today, nodes => nodes.filter(n => n.id !== row), { singleDeleteIds: [row] }, 'delete-again')
  s.run({ type: 'undo', targetOperationId: 'delete-again' })
  assert.equal(has(s.ws, t.id), true)
})

test('cleanup: only orphans born on their page, all or nothing; Undo restores them', () => {
  const s = setup(), junk = s.add('aa'), keep = s.add('Real task', { deadlineOn: later })
  // Leave both without a line, as the old rule did (Not today, row removed).
  for (const t of [junk, keep]) { const row = s.rowOf(t.id).id; s.save(today, nodes => nodes.filter(n => n.id !== row), { cutTaskIds: [t.id] }) }
  assert.throws(() => s.run({ type: 'delete-orphan-tasks', taskIds: [junk.id, keep.id] }), /has history/)
  assert.equal(has(s.ws, junk.id), true, 'nothing deleted when one fails')
  s.run({ type: 'delete-orphan-tasks', taskIds: [junk.id] }, 'cleanup')
  assert.equal(has(s.ws, junk.id), false)
  assert.equal(has(s.ws, keep.id), true)
  s.run({ type: 'undo', targetOperationId: 'cleanup' })
  assert.equal(has(s.ws, junk.id), true)
})

test('the editor\'s notice and the save decide the same way: another page, another line here (Ratchet 164)', () => {
  const s = setup(), shared = s.add('Also on a doc'), twice = s.add('Twice here')
  s.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' })
  const doc = s.ws.pages.find(p => p.id === 'doc')!
  s.run({ type: 'save-editor', pageId: 'doc', expectedContent: pageContentKey(doc), document: JSON.stringify([...editorSeed(doc, s.ws), { id: 'doc-row', type: 'task', props: { taskId: shared.id }, content: 'Also on a doc' }]) })
  const d = editorSeed(s.page(today), s.ws), at = d.findIndex(n => n.props?.taskId === twice.id)
  s.save(today, () => [...d.slice(0, at + 1), { id: 'twice-2', type: 'task', props: { taskId: twice.id, role: 'reference' }, content: 'Twice here' } as EditorNode, ...d.slice(at + 1)])
  for (const t of [shared, twice]) {
    const row = s.rowOf(t.id).id, after = editorSeed(s.page(today), s.ws).filter(n => n.id !== row)
    const predicted = deletesWithLine(s.ws, s.page(today), t.id, new Set(after.filter(n => n.type === 'task').map(n => String(n.props?.taskId))))
    s.save(today, () => after, { singleDeleteIds: [row] })
    assert.equal(predicted, false, t.title)
    assert.equal(has(s.ws, t.id), !predicted, `${t.title}: the save did what the notice said`)
  }
  assert.equal(s.ws.tasks.find(t => t.id === twice.id)!.plannedOn, today, 'a copy deleted on the page doesn\'t take the task off the day')
})
