import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { resolveLine } from '../src/domain/page-refs.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import type { Action, Page, Workspace } from '../src/domain/types.ts'

// A11 (docs/plan/a11-line-links.md §2, §8): one resolver for the chip, the jump, the plain URL and Linked from.
const yesterday = '2026-10-15', today = '2026-10-16', tomorrow = '2026-10-17', friday = '2026-10-18'

function setup() {
  let state = createEmptyWorkspace(), sequence = 0
  const run = (action: Action) => {
    state = applyCommand(state, { operationId: `a11-${++sequence}`, expectedRevision: state.revision, action }).workspace
    return state
  }
  const day = (date: string) => {
    run({ type: 'ensure-day', date })
    return state.pages.find(p => p.date === date)!
  }
  const add = (date: string, title: string) => {
    const page = day(date)
    run({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(s => s.kind === 'other')!.id, title, plannedOn: date })
    return state.tasks.at(-1)!
  }
  const page = (id: string) => state.pages.find(p => p.id === id || p.date === id)!
  /** Saves a page through the editor, as the browser does: the current editor document, changed by `edit`. */
  const save = (id: string, edit: (nodes: EditorNode[]) => EditorNode[]) => {
    const p = page(id)
    return run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, state))) })
  }
  const doc = (id: string, title = id) => run({ type: 'create-document', title, body: '', pageId: id })
  return { run, day, add, page, save, doc, get state() { return state } }
}
const rowOf = (p: Page, taskId: string) => p.sections.flatMap(s => s.blocks).find(b => b.kind === 'task' && b.taskId === taskId)
const taskNode = (id: string, taskId: string, text: string): EditorNode => ({ id, type: 'task', props: { taskId }, content: text } as EditorNode)
const line = (id: string, text: string): EditorNode => ({ id, type: 'paragraph', content: text } as EditorNode)

test('task: past → today', () => {
  const s = setup(), t = s.add(yesterday, 'Old')
  const source = s.page(yesterday), lineId = rowOf(source, t.id)!.id
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  assert.ok(rowOf(s.page(yesterday), t.id), "the past day's history row stays")
  const r = resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId, r.blockId, r.words], ['moved', s.page(today).id, rowOf(s.page(today), t.id)!.id, 'Old'])
})

test('task: today → tomorrow', () => {
  const s = setup(), t = s.add(today, 'Report')
  const source = s.page(today), lineId = rowOf(source, t.id)!.id
  s.day(tomorrow)
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'other', from: today, today })
  assert.equal(rowOf(s.page(today), t.id), undefined, 'the source row is gone')
  const target = { state: 'moved', pageId: s.page(tomorrow).id, blockId: rowOf(s.page(tomorrow), t.id)!.id, words: 'Report', taskId: t.id }
  // The chip carries taskId; a URL without task= finds the task from the source page's kept copy of the row.
  assert.deepEqual(resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id }), target)
  assert.deepEqual(resolveLine(s.state, { pageId: source.id, lineId }), target)
})

test('task: today → tomorrow, a row first saved by the editor', () => {
  const s = setup(), p = s.day(today)
  s.save(today, nodes => nodes.flatMap(n => n.id === 'day:2026-10-16:other' ? [n, taskNode('typed', `editor-task:typed`, 'Typed')] : [n]))
  const t = s.state.tasks.at(-1)!
  assert.equal(rowOf(s.page(today), t.id)!.id, 'typed')
  s.day(tomorrow)
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'other', from: today, today })
  const r = resolveLine(s.state, { pageId: p.id, lineId: 'typed' })
  assert.deepEqual([r.state, r.pageId, r.taskId], ['moved', s.page(tomorrow).id, t.id])
})

test('task: rescheduled twice', () => {
  const s = setup(), t = s.add(today, 'Twice')
  const source = s.page(today), lineId = rowOf(source, t.id)!.id
  s.day(tomorrow); s.day(friday)
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'other', from: today, today })
  s.run({ type: 'plan-task', taskId: t.id, date: friday, section: 'other', from: tomorrow, today })
  for (const target of [{ pageId: source.id, lineId, taskId: t.id }, { pageId: source.id, lineId }])
    assert.deepEqual([resolveLine(s.state, target).state, resolveLine(s.state, target).pageId], ['moved', s.page(friday).id])
})

test('task: done', () => {
  const s = setup(), t = s.add(yesterday, 'Shipped')
  const source = s.page(yesterday), lineId = rowOf(source, t.id)!.id
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today })
  assert.equal(s.state.tasks[0]!.doneOn, today)
  let r = resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['moved', s.page(today).id])
  // Ticked on yesterday's page after it was planned on: doneOn wins over the plan day.
  s.run({ type: 'task-status', taskId: t.id, status: 'open', today })
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today: yesterday })
  r = resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['live', source.id])
})

test('task: done before A11', () => {
  const s = setup(), t = s.add(yesterday, 'Old done')
  const source = s.page(yesterday), lineId = rowOf(source, t.id)!.id
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  // An older build sent no `today`, and a task done before A11 has no doneOn: the derived day is its latest plan day.
  s.run({ type: 'task-status', taskId: t.id, status: 'done' })
  assert.equal(s.state.tasks[0]!.doneOn ?? null, null)
  const r = resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['moved', s.page(today).id])
})

test('task: not today, paused', () => {
  const s = setup(), t = s.add(yesterday, 'Someday')
  const source = s.page(yesterday), lineId = rowOf(source, t.id)!.id
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  s.run({ type: 'not-today', taskId: t.id, date: today })
  assert.equal(s.state.tasks[0]!.plannedOn, null)
  // No plan day: the newest live row. Today's row is gone, so yesterday's history row, by date.
  let r = resolveLine(s.state, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['live', source.id])
  // With rows on two days and no plan day, the newer day wins (synthetic: today's row kept, plan cleared).
  const two = setup(), v = two.add(yesterday, 'Two days')
  two.day(today)
  two.run({ type: 'plan-task', taskId: v.id, date: today, section: 'other', from: yesterday, today })
  const ws = structuredClone(two.state)
  ws.tasks[0]!.plannedOn = null
  r = resolveLine(ws, { pageId: two.page(yesterday).id, lineId: rowOf(two.page(yesterday), v.id)!.id, taskId: v.id })
  assert.deepEqual([r.state, r.pageId], ['moved', two.page(today).id])
  // Daily rows come before document rows; among documents, the highest `seen`, then page id.
  const d = setup(), u = d.add(today, 'Doc task')
  d.run({ type: 'not-today', taskId: u.id, date: today })
  assert.equal(rowOf(d.page(today), u.id), undefined)
  d.doc('b-doc'); d.doc('a-doc')
  d.save('b-doc', nodes => [...nodes, taskNode('in-b', u.id, 'Doc task')])
  d.save('a-doc', nodes => [...nodes, taskNode('in-a', u.id, 'Doc task')])
  r = resolveLine(d.state, { pageId: d.page(today).id, lineId: 'x', taskId: u.id })
  assert.deepEqual([r.pageId, r.blockId], ['a-doc', 'in-a'], 'a-doc was saved last, so its row is newest')
  d.save('b-doc', nodes => [...nodes, line('touch', 'touch')])
  r = resolveLine(d.state, { pageId: d.page(today).id, lineId: 'x', taskId: u.id })
  assert.deepEqual([r.pageId, r.blockId], ['b-doc', 'in-b'], 'saving b-doc again stamps its row newer')
})

test('task: only trashed rows', () => {
  const s = setup(), t = s.add(today, 'Filed')
  s.run({ type: 'not-today', taskId: t.id, date: today })
  s.doc('one'); s.doc('two')
  s.save('two', nodes => [...nodes, taskNode('r2', t.id, 'Filed')])
  s.save('one', nodes => [...nodes, taskNode('r1', t.id, 'Filed')])
  s.run({ type: 'delete-page', pageId: 'one', at: '2026-10-16T10:00:00.000Z' })
  let r = resolveLine(s.state, { pageId: 'one', lineId: 'r1', taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['moved', 'two'], 'a live row comes before a trashed one')
  s.run({ type: 'delete-page', pageId: 'two', at: '2026-10-16T10:01:00.000Z' })
  r = resolveLine(s.state, { pageId: 'one', lineId: 'r1', taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['trashed', 'one'], 'only trashed rows: the newest trashed page')
})

test('task: two rows on one page', () => {
  const s = setup(), t = s.add(today, 'Twice here')
  s.run({ type: 'not-today', taskId: t.id, date: today })
  s.doc('one')
  s.save('one', nodes => [...nodes, taskNode('first', t.id, 'Twice here'), taskNode('second', t.id, 'Twice here')])
  // Unequal stamps (Ratchet #143): the later row stamped newer still loses to the first in document order.
  const ws = structuredClone(s.state), meta = ws.pages.find(p => p.id === 'one')!.editorBlockMetadata!
  meta.first!.seen = 1; meta.second!.seen = 99
  const r = resolveLine(ws, { pageId: 'one', lineId: 'second', taskId: t.id })
  assert.deepEqual([r.state, r.blockId], ['live', 'first'])
})

test('task: rows on two pages, either array order', () => {
  // Ratchet #143: page A's rows stamped 1 and 10, page B's row 5. A is newer (10), and on A the first row wins.
  const s = setup(), t = s.add(today, 'Spread')
  s.run({ type: 'not-today', taskId: t.id, date: today })
  s.doc('A'); s.doc('B')
  s.save('A', nodes => [...nodes, taskNode('a-first', t.id, 'Spread'), taskNode('a-second', t.id, 'Spread')])
  s.save('B', nodes => [...nodes, taskNode('b-only', t.id, 'Spread')])
  const ws = structuredClone(s.state), meta = (id: string) => ws.pages.find(p => p.id === id)!.editorBlockMetadata!
  meta('A')['a-first']!.seen = 1; meta('A')['a-second']!.seen = 10; meta('B')['b-only']!.seen = 5
  const a = ws.pages.findIndex(p => p.id === 'A'), b = ws.pages.findIndex(p => p.id === 'B')
  const swapped = structuredClone(ws); [swapped.pages[a], swapped.pages[b]] = [swapped.pages[b]!, swapped.pages[a]!]
  for (const w of [ws, swapped]) {
    const r = resolveLine(w, { pageId: 'B', lineId: 'b-only', taskId: t.id })
    assert.deepEqual([r.pageId, r.blockId], ['A', 'a-first'])
  }
})

test('task: B16 note', () => {
  const s = setup(), t = s.add(yesterday, 'Planned')
  const source = s.page(yesterday), lineId = rowOf(source, t.id)!.id
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  // Day pages can't be trashed yet (A4 is documents only), so mark the plan day trashed directly.
  const ws = structuredClone(s.state)
  ws.pages.find(p => p.date === today)!.trashedAt = '2026-10-16T10:00:00.000Z'
  const r = resolveLine(ws, { pageId: source.id, lineId, taskId: t.id })
  assert.deepEqual([r.state, r.pageId], ['trashed', s.page(today).id], 'trashed for the plan day, not the history row')
})

test('line: live / not found / page not found', () => {
  const s = setup()
  s.doc('notes')
  s.save('notes', nodes => [...nodes, line('l1', 'First line')])
  assert.deepEqual(resolveLine(s.state, { pageId: 'notes', lineId: 'l1' }), { state: 'live', pageId: 'notes', blockId: 'l1', words: 'First line' })
  s.save('notes', nodes => nodes.filter(n => n.id !== 'l1'))
  assert.deepEqual(resolveLine(s.state, { pageId: 'notes', lineId: 'l1' }), { state: 'line-not-found', pageId: 'notes', words: '' })
  assert.deepEqual(resolveLine(s.state, { pageId: 'gone', lineId: 'l1' }), { state: 'page-not-found', pageId: 'gone', words: '' })
})

test('line: cut and pasted elsewhere', () => {
  const s = setup()
  s.doc('from'); s.doc('to')
  s.save('from', nodes => [...nodes, line('l1', 'Moving line')])
  // A paste gets a fresh id in v1 (§0), so the line's old id is on no page.
  s.save('from', nodes => nodes.filter(n => n.id !== 'l1'))
  s.save('to', nodes => [...nodes, line('l1-pasted', 'Moving line')])
  assert.deepEqual(resolveLine(s.state, { pageId: 'from', lineId: 'l1' }), { state: 'line-not-found', pageId: 'from', words: '' })
})

test('line: holder trashed', () => {
  const s = setup()
  s.doc('holder')
  s.save('holder', nodes => [...nodes, line('l1', 'Kept line')])
  s.run({ type: 'delete-page', pageId: 'holder', at: '2026-10-16T10:00:00.000Z' })
  assert.deepEqual(resolveLine(s.state, { pageId: 'holder', lineId: 'l1' }), { state: 'trashed', pageId: 'holder', blockId: 'l1', words: 'Kept line' })
  assert.equal(resolveLine(s.state, { pageId: 'holder', lineId: 'missing' }).state, 'trashed')
  s.run({ type: 'restore-page', pageId: 'holder' })
  assert.equal(resolveLine(s.state, { pageId: 'holder', lineId: 'l1' }).state, 'live')
})

test('heading: custom vs template', () => {
  const s = setup(), p = s.day(today)
  s.save(today, nodes => [...nodes, { id: 'mine', type: 'heading', props: { level: 2 }, content: 'Reading' } as EditorNode])
  assert.equal(s.page(today).sections.find(x => x.id === 'mine')?.kind, 'custom')
  assert.deepEqual(resolveLine(s.state, { pageId: p.id, lineId: 'mine' }), { state: 'live', pageId: p.id, blockId: 'mine', words: 'Reading' })
  s.save(today, nodes => nodes.map(n => n.id === 'mine' ? { ...n, content: 'Reading list' } : n))
  assert.equal(resolveLine(s.state, { pageId: p.id, lineId: 'mine' }).words, 'Reading list')
  assert.equal(resolveLine(s.state, { pageId: p.id, lineId: 'day:2026-10-16:notes' }).state, 'line-not-found')
})

test('words: current projection', () => {
  const s = setup(), t = s.add(today, 'First title')
  const lineId = rowOf(s.page(today), t.id)!.id
  s.save(today, nodes => nodes.map(n => n.id === lineId ? { ...n, content: 'Second title' } : n))
  s.doc('notes')
  s.save('notes', nodes => [...nodes, line('l1', 'before')])
  s.save('notes', nodes => nodes.map(n => n.id === 'l1' ? { ...n, content: 'after' } : n))
  assert.equal(resolveLine(s.state, { pageId: 'notes', lineId: 'l1' }).words, 'after')
  // The stored editor JSON is never read for words: change it without a projection, the words stay.
  const ws = structuredClone(s.state)
  ws.pages.find(p => p.id === 'notes')!.editorJSON = JSON.stringify([line('l1', 'stale json')])
  assert.equal(resolveLine(ws, { pageId: 'notes', lineId: 'l1' }).words, 'after')
  assert.equal(resolveLine(s.state, { pageId: s.page(today).id, lineId }).words, 'Second title')
})

test('seen: first save', () => {
  const s = setup(), t = s.add(today, 'Stamped')
  s.run({ type: 'not-today', taskId: t.id, date: today })
  s.doc('one')
  s.save('one', nodes => [...nodes, taskNode('r1', t.id, 'Stamped')])
  assert.equal(s.page('one').editorBlockMetadata?.r1?.seen, s.state.revision)
  // An entry written by an older build has no `seen`: it ranks below a stamped one, whatever the page id.
  s.doc('aa')
  s.save('aa', nodes => [...nodes, taskNode('r0', t.id, 'Stamped')])
  const ws = structuredClone(s.state)
  delete ws.pages.find(p => p.id === 'aa')!.editorBlockMetadata!.r0!.seen
  assert.equal(resolveLine(ws, { pageId: 'one', lineId: 'r1', taskId: t.id }).pageId, 'one')
})

test('doneOn: every path', () => {
  const s = setup(), t = s.add(today, 'Tick')
  const doneOn = () => s.state.tasks.find(x => x.id === t.id)!.doneOn ?? null
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today })
  assert.equal(doneOn(), today, 'task-status done (row ✓ and the editor tick send today)')
  s.run({ type: 'task-status', taskId: t.id, status: 'open', today })
  assert.equal(doneOn(), null, 'reopened')
  s.run({ type: 'task-status', taskId: t.id, status: 'done', today: tomorrow })
  s.run({ type: 'task-status', taskId: t.id, status: 'cancelled' })
  assert.equal(doneOn(), null, 'cancelled')
})

test('browser = server metadata', () => {
  const s = setup(), t = s.add(today, 'Mirror')
  s.doc('notes')
  s.save('notes', nodes => [...nodes, line('l1', 'one'), taskNode('r1', t.id, 'Mirror')])
  s.save('notes', nodes => nodes.filter(n => n.id !== 'l1'))
  s.day(tomorrow)
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'other', from: today, today })
  s.run({ type: 'undo', targetOperationId: s.state.undo!.operationId })
  const browser = forBrowser(s.state)
  assert.deepEqual(browser.pages.map(p => p.editorBlockMetadata), s.state.pages.map(p => p.editorBlockMetadata))
})

/** The guard runs on any workspace; the release check points it at the candidate's copy of his data (A11_DATA). */
function largestMetadata(ws: Workspace) {
  return ws.pages.map(p => ({ page: p.title ?? p.date ?? p.id, bytes: Buffer.byteLength(JSON.stringify(p.editorBlockMetadata ?? {})) })).sort((a, b) => b.bytes - a.bytes)[0]
}
test('metadata size guard', () => {
  const path = process.env.A11_DATA
  let ws: Workspace
  if (path) ws = JSON.parse(readFileSync(path, 'utf8'))
  else {
    const s = setup(), t = s.add(today, 'Guarded')
    s.save(today, nodes => [...nodes, line('l1', 'a line')])
    s.run({ type: 'not-today', taskId: t.id, date: today })
    ws = s.state
  }
  const largest = largestMetadata(ws)
  if (largest) console.log(`largest editorBlockMetadata: ${largest.page} ${largest.bytes} B`)
  assert.ok(!largest || largest.bytes < 100_000)
})
