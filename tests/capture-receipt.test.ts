import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import type { Action, ProposalItem, ServerAction, Workspace } from '../src/domain/types.ts'
import { commandSchema } from '../src/domain/command-schema.ts'

// Receipt v2 (Jazz 283697c, check list 09387e2): fixing one item of a model capture.
const run = (ws: Workspace, action: Action | ServerAction) => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace
const p = (x: Partial<ProposalItem> & Pick<ProposalItem, 'kind' | 'title'>): ProposalItem => ({ id: crypto.randomUUID(), flags: [], ...x })
function organized(proposals: ProposalItem[], mode: 'auto' | 'confirm' = 'auto') {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  ws = run(ws, { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'Book flights tomorrow, Swim class tomorrow afternoon', model: 'm', capturedAt: '2026-10-19T16:00:00Z' })
  const captureId = ws.captures[0]!.id
  ws = run(ws, { type: 'organized-capture', captureId, revision: 1, model: 'm', mode, proposals, unreadable: 0, contextLine: 'ctx' })
  return { ws, captureId, item: (w: Workspace, title: string) => w.captures[0]!.proposals!.find(x => x.title === title)! }
}

test('a saved task shows and keeps its date; editing its date changes the same task row, and Undo reverts that one edit', () => {
  const { ws: start, captureId, item } = organized([p({ kind: 'create-task', title: 'Book flights', date: '2026-10-20', dateRole: 'do' })])
  const id = item(start, 'Book flights').id
  assert.equal(start.tasks[0]!.plannedOn, '2026-10-20')
  const edit = { operationId: 'edit', expectedRevision: start.revision, action: { type: 'edit-capture-item' as const, captureId, itemId: id, date: '2026-10-22' } }
  const ws = applyCommand(start, edit).workspace
  assert.equal(ws.tasks.length, 1); assert.equal(ws.tasks[0]!.plannedOn, '2026-10-22')
  assert.equal(item(ws, 'Book flights').id, id); assert.equal(item(ws, 'Book flights').state, 'applied')
  const undone = run(ws, { type: 'undo', targetOperationId: 'edit' })
  assert.equal(undone.tasks[0]!.plannedOn, '2026-10-20')
})

test('changing a saved item\'s type (task → event) replaces it: one row, no task left behind', () => {
  const { ws: start, captureId, item } = organized([p({ kind: 'create-task', title: 'Swim class', date: '2026-10-20', dateRole: 'do' })])
  const ws = run(start, { type: 'edit-capture-item', captureId, itemId: item(start, 'Swim class').id, kind: 'create-event', time: '15:00' })
  assert.equal(ws.tasks.length, 0); assert.equal(ws.events[0]!.title, 'Swim class'); assert.equal(ws.events[0]!.time, '15:00')
})

test('a held item: editing the flagged field clears that reason; Save saves it; Remove drops it without touching the others', () => {
  const { ws: start, captureId, item } = organized([
    p({ kind: 'create-task', title: 'Book flights', date: '2026-10-20', dateRole: 'do' }),
    p({ kind: 'create-event', title: 'Swim class', date: '2026-10-20', time: '14:00', flags: ['time-not-in-text'] }),
    p({ kind: 'create-task', title: 'Renew passport', date: null, flags: ['date-missing'] }),
  ])
  assert.equal(start.captures[0]!.status, 'needs_confirmation')
  let ws = run(start, { type: 'edit-capture-item', captureId, itemId: item(start, 'Swim class').id, time: null })
  assert.deepEqual(item(ws, 'Swim class').flags, []); assert.equal(item(ws, 'Swim class').state, undefined)
  ws = run(ws, { type: 'save-capture-item', captureId, itemId: item(ws, 'Swim class').id })
  assert.equal(ws.events[0]!.time, null)
  ws = run(ws, { type: 'remove-capture-item', captureId, itemId: item(ws, 'Renew passport').id })
  assert.equal(ws.captures[0]!.status, 'applied'); assert.equal(ws.tasks.length, 1)
})

test('Undo all reverts every saved item in one step; it is refused whole if one was edited since', () => {
  const { ws: start, captureId } = organized([
    p({ kind: 'create-task', title: 'Book flights', date: '2026-10-20', dateRole: 'do' }),
    p({ kind: 'add-note', title: 'Swim class tomorrow afternoon' }),
  ])
  const all = run(start, { type: 'undo-capture', captureId })
  assert.equal(all.tasks.length, 0); assert.equal(all.captures[0]!.status, 'discarded'); assert.equal(all.captures[0]!.text, start.captures[0]!.text)
  assert.equal(all.pages[0]!.sections.flatMap(s => s.blocks).some(b => b.text === 'Swim class tomorrow afternoon'), false)
  const edited = run(start, { type: 'task-status', taskId: start.tasks[0]!.id, status: 'done' })
  assert.throws(() => run(edited, { type: 'undo-capture', captureId }), /edited since/)
})

test('retry: only a failed model capture, never on budget; it opens a new revision', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  ws = run(ws, { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'call dentist', model: 'm', capturedAt: '2026-10-19T16:00:00Z' })
  const id = ws.captures[0]!.id
  ws = run(ws, { type: 'model-failed', captureId: id, revision: 1, failure: 'failure', error: 'Model unavailable · text saved' })
  ws = run(ws, { type: 'retry-capture', captureId: id })
  assert.equal(ws.captures[0]!.status, 'organizing'); assert.equal(ws.captures[0]!.proposalRevision, 2)
  // The old revision's late result can't apply any more.
  assert.throws(() => run(ws, { type: 'organized-capture', captureId: id, revision: 1, model: 'm', mode: 'auto', proposals: [], unreadable: 0, contextLine: '' }), /moved on/)
  ws = run(ws, { type: 'model-failed', captureId: id, revision: 2, failure: 'budget', error: "Today's model budget is used up · text saved" })
  assert.throws(() => run(ws, { type: 'retry-capture', captureId: id }), /budget/)
})

test('retry: never on a capture paused because a cost couldn\'t be confirmed', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  ws = run(ws, { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'call dentist', model: 'm', capturedAt: '2026-10-19T16:00:00Z' })
  const id = ws.captures[0]!.id
  ws = run(ws, { type: 'model-failed', captureId: id, revision: 1, failure: 'paused', error: "Model paused · a cost couldn't be confirmed · text saved" })
  assert.throws(() => run(ws, { type: 'retry-capture', captureId: id }), /paused/)
  assert.equal(ws.captures[0]!.text, 'call dentist')
})

test('the browser can send the receipt commands, but not retry-capture (server only)', () => {
  const command = (action: object) => ({ operationId: 'op', expectedRevision: 0, action })
  assert.equal(commandSchema.safeParse(command({ type: 'remove-capture-item', captureId: 'c', itemId: 'i' })).success, true)
  assert.equal(commandSchema.safeParse(command({ type: 'edit-capture-item', captureId: 'c', itemId: 'i', date: '2026-10-20', dateRole: 'due' })).success, true)
  assert.equal(commandSchema.safeParse(command({ type: 'retry-capture', captureId: 'c' })).success, false)
})

test('Undo all also puts back an applied update, unless the task changed since', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  ws = run(ws, { type: 'add-task', pageId: ws.pages[0]!.id, sectionId: ws.pages[0]!.sections[0]!.id, title: 'Tax Return' })
  const t = ws.tasks[0]!
  ws = run(ws, { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'move Tax Return to tomorrow', model: 'm', capturedAt: '2026-10-19T16:00:00Z' })
  const id = ws.captures[0]!.id
  ws = run(ws, { type: 'organized-capture', captureId: id, revision: 1, model: 'm', mode: 'auto', proposals: [{ id: 'u', kind: 'update-task', title: 'Tax Return', taskId: t.id, expectedVersion: t.version, date: '2026-10-20', dateRole: null, flags: [] }], unreadable: 0, contextLine: '' })
  const placementsBefore = ws.placements.filter(x => x.taskId === t.id)
  ws = run(ws, { type: 'save-capture-item', captureId: id, itemId: 'u' })
  assert.equal(ws.tasks[0]!.plannedOn, '2026-10-20')
  const undone = run(ws, { type: 'undo-capture', captureId: id })
  assert.equal(undone.tasks[0]!.plannedOn, t.plannedOn)
  assert.deepEqual(undone.placements.filter(x => x.taskId === t.id), placementsBefore)
  const edited = run(ws, { type: 'task-status', taskId: t.id, status: 'done' })
  assert.throws(() => run(edited, { type: 'undo-capture', captureId: id }), /edited since/)
})
