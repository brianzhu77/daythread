import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView } from '../src/domain/workspace.ts'
import { chipEvents, dayEvents } from '../src/domain/chip-events.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B27 plan revision 2 §1–§2: events are read from the `@date` chips in the documents; nothing is kept in sync.
const run = (ws: Workspace, action: Action) => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const chip = (eventId: string, date: string, time = '') => ({ type: 'dateMention', props: { eventId, date, time } })
const line = (id: string, content: unknown[], type = 'bulletListItem', props: Record<string, unknown> = {}) => ({ id, type, props, content, children: [] }) as unknown as EditorNode
const day = (ws: Workspace, date: string) => ws.pages.find(p => p.type === 'daily' && p.date === date)!

/** Saves the page's document with `lines` at the end of its Notes section (or replacing them, for edits). */
function save(ws: Workspace, pageId: string, lines: EditorNode[], options: { history?: boolean } = {}) {
  const page = ws.pages.find(p => p.id === pageId)!
  const nodes = editorSeed(page, ws).filter(n => !lines.some(l => l.id === n.id) && !n.id.startsWith('own:'))
  const notes = page.sections.find(s => s.kind === 'notes')?.id
  let at = notes ? nodes.findIndex(n => n.id === notes) + 1 : nodes.length
  while (notes && at < nodes.length && nodes[at]!.type !== 'heading') at++
  nodes.splice(at, 0, ...lines)
  return run(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(nodes), ...(options.history ? { history: true } : {}) })
}
const without = (ws: Workspace, pageId: string, lineId: string, options: { history?: boolean } = {}) => {
  const page = ws.pages.find(p => p.id === pageId)!
  const drop = (list: EditorNode[]): EditorNode[] => list.filter(n => n.id !== lineId).map(n => ({ ...n, children: drop(n.children ?? []) }))
  return run(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(drop(editorSeed(page, ws))), ...(options.history ? { history: true } : {}) })
}
function start() {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-22' })
  ws = save(ws, 'day:2026-10-22', [line('pac', [text('PAC Lunch '), chip('e1', '2026-11-20', '12:00')])])
  return ws
}

test('a chip makes an event from the save that holds it: title is the line without the chip, date and time from the chip', () => {
  const ws = start()
  assert.deepEqual([...chipEvents(ws).values()], [{ id: 'e1', title: 'PAC Lunch', date: '2026-11-20', time: '12:00', line: { pageId: 'day:2026-10-22', lineId: 'pac' } }])
  assert.deepEqual(dayEvents(ws, '2026-11-20').map(e => e.title), ['PAC Lunch'])
  assert.deepEqual(getDayView(ws, '2026-11-20').events.map(e => e.id), ['e1'], 'the day view is the same one list')
  assert.equal(ws.events.length, 0, 'nothing stored')
  assert.equal(day(ws, '2026-10-22').sections.find(s => s.kind === 'notes')!.blocks.find(b => b.id === 'pac')!.text, 'PAC Lunch @Nov 20 12pm', 'stored text names the date')
})

test('opening a future day with no page shows the event and writes nothing', () => {
  const ws = start()
  assert.equal(ws.pages.some(p => p.date === '2026-11-20'), false)
  const revision = ws.revision, pages = ws.pages.length
  assert.deepEqual(getDayView(ws, '2026-11-20').events.map(e => e.title), ['PAC Lunch'])
  assert.equal(ws.revision, revision); assert.equal(ws.pages.length, pages)
  const made = run(ws, { type: 'ensure-day', date: '2026-11-20' })
  assert.deepEqual(getDayView(made, '2026-11-20').events.map(e => e.id), ['e1'], 'Create page keeps the row')
})

test('editing the line renames the event; deleting it removes the event; ⌘Z brings both back', () => {
  let ws = start()
  ws = save(ws, 'day:2026-10-22', [line('pac', [text('PAC Lunch at school  '), chip('e1', '2026-11-20', '12:00'), text(' ')])])
  assert.equal(chipEvents(ws).get('e1')?.title, 'PAC Lunch at school')
  ws = without(ws, 'day:2026-10-22', 'pac')
  assert.equal(chipEvents(ws).size, 0)
  ws = save(ws, 'day:2026-10-22', [line('pac', [text('PAC Lunch at school '), chip('e1', '2026-11-20', '12:00')])], { history: true })
  assert.deepEqual(dayEvents(ws, '2026-11-20').map(e => [e.id, e.title, e.time]), [['e1', 'PAC Lunch at school', '12:00']])
})

test('the same id in two lines is one event, taken whole from the newest day page; it lasts while any line holds it', () => {
  let ws = start()
  ws = run(ws, { type: 'ensure-day', date: '2026-10-23' })
  ws = save(ws, 'day:2026-10-23', [line('copy', [text('PAC lunch (moved) '), chip('e1', '2026-11-21', '13:00')])])
  // A different date on the newer holder (a conflict merge could do that): all fields come from that one holder.
  assert.deepEqual([...chipEvents(ws).values()], [{ id: 'e1', title: 'PAC lunch (moved)', date: '2026-11-21', time: '13:00', line: { pageId: 'day:2026-10-23', lineId: 'copy' } }])
  assert.deepEqual(dayEvents(ws, '2026-11-20'), [], 'no half-and-half event on the older date')
  ws = without(ws, 'day:2026-10-23', 'copy')
  assert.deepEqual(chipEvents(ws).get('e1')?.line, { pageId: 'day:2026-10-22', lineId: 'pac' }, 'the remaining holder becomes the link')
  ws = without(ws, 'day:2026-10-22', 'pac')
  assert.equal(chipEvents(ws).size, 0)
})

test('the same id twice on one page is one event (the first line)', () => {
  let ws = start()
  ws = save(ws, 'day:2026-10-22', [line('pac2', [text('Again '), chip('e1', '2026-11-20')])])
  assert.equal(chipEvents(ws).size, 1)
  assert.equal(chipEvents(ws).get('e1')?.line?.lineId, 'pac')
})

test('Bring keeps the chip with the same id: one event, linked to the brought line; deleting the original keeps it', () => {
  let ws = start()
  ws = run(ws, { type: 'ensure-day', date: '2026-10-23' })
  ws = run(ws, { type: 'bring-line', date: '2026-10-23', sourcePageId: 'day:2026-10-22', sourceBlockId: 'pac' })
  const brought = day(ws, '2026-10-23')
  const doc = JSON.parse(brought.editorJSON!) as EditorNode[]
  const flat = (l: EditorNode[]): EditorNode[] => l.flatMap(n => [n, ...flat(n.children ?? [])])
  const copy = flat(doc).find(n => Array.isArray(n.content) && (n.content as { type?: string }[]).some(c => c.type === 'dateMention'))!
  assert.equal((copy.content as { type?: string; props?: { eventId?: string } }[]).find(c => c.type === 'dateMention')!.props!.eventId, 'e1', 'the copied document holds the same eventId')
  assert.equal(dayEvents(ws, '2026-11-20').length, 1)
  assert.deepEqual(chipEvents(ws).get('e1')?.line, { pageId: brought.id, lineId: copy.id })
  ws = without(ws, 'day:2026-10-22', 'pac')
  assert.deepEqual(dayEvents(ws, '2026-11-20').map(e => e.title), ['PAC Lunch'])
})

test('a document page in the trash hides its events; restoring brings them back', () => {
  let ws = run(createEmptyWorkspace(), { type: 'create-document', title: 'Trip notes', body: '', pageId: 'doc' })
  ws = save(ws, 'doc', [line('flight', [text('Flight '), chip('e2', '2026-12-01', '08:15')])])
  assert.equal(ws.pages.find(p => p.id === 'doc')!.sections.flatMap(s => s.blocks).find(b => b.id === 'flight')!.text, 'Flight @Dec 1, 2026 8:15am', 'a document page always gets the year')
  assert.equal(dayEvents(ws, '2026-12-01').length, 1)
  ws = run(ws, { type: 'delete-page', pageId: 'doc', at: '2026-10-25T00:00:00Z' })
  assert.equal(dayEvents(ws, '2026-12-01').length, 0)
  ws = run(ws, { type: 'restore-page', pageId: 'doc' })
  assert.equal(dayEvents(ws, '2026-12-01').length, 1)
})

test('a chip on a to-do row: event only, the task keeps its dates, its title reads the date', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-22' })
  ws = save(ws, 'day:2026-10-22', [line('todo', [text('Call dentist '), chip('e3', '2026-10-30', '15:00')], 'task', { taskId: 'editor-task:todo', role: 'plan', planDate: '2026-10-22' })])
  const task = ws.tasks.find(t => t.id === 'editor-task:todo')!
  assert.equal(task.title, 'Call dentist @Oct 30 3pm')
  assert.equal(task.plannedOn, '2026-10-22')
  assert.equal(task.deadlineOn, null)
  assert.deepEqual(dayEvents(ws, '2026-10-30').map(e => e.title), ['Call dentist'])
})

test('stored and chip events share one list: all-day first, then by time; cancelled stored ones are left out', () => {
  let ws = start()
  ws = run(ws, { type: 'add-event', pageId: 'day:2026-10-22', title: 'Stored', date: '2026-11-20', time: '09:00' })
  ws = save(ws, 'day:2026-10-22', [line('allday', [chip('e4', '2026-11-20')])])
  assert.deepEqual(dayEvents(ws, '2026-11-20').map(e => [e.title, e.time]), [['', null], ['Stored', '09:00'], ['PAC Lunch', '12:00']])
})

test('the memo follows the workspace: a change made in place and a new revision is read afresh', () => {
  const ws = start()
  assert.equal(chipEvents(ws).size, 1)
  const after = save(ws, 'day:2026-10-22', [line('more', [text('More '), chip('e5', '2026-11-22')])])
  assert.equal(chipEvents(after).size, 2)
  assert.equal(chipEvents(ws).size, 1, 'the earlier workspace still reads its own')
  // The same object changed in place and given a new revision (what a command does to its working copy).
  const page = ws.pages.find(p => p.id === 'day:2026-10-22')!
  page.trashedAt = '2026-10-25T00:00:00Z'; ws.revision++
  assert.equal(chipEvents(ws).size, 0)
})

test('malformed chips and documents don\'t break the day', () => {
  let ws = start()
  ws = save(ws, 'day:2026-10-22', [line('bad', [text('Bad '), { type: 'dateMention', props: { eventId: 'e6', date: '2026-02-30' } }])])
  assert.equal(chipEvents(ws).has('e6'), false)
  const broken = structuredClone(ws)
  const page = broken.pages.find(p => p.id === 'day:2026-10-22')!
  page.editorJSON = '{not json'; page.editorSections = JSON.stringify(page.sections)
  assert.doesNotThrow(() => dayEvents(broken, '2026-11-20'))
})
