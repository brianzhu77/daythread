import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, eveningPicks, isCardDraft } from '../src/domain/workspace.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B47 (Lead c94fbc25, Bumblebee 68158ff6): the evening review's draft ("Prepare tomorrow") doesn't take Draft my day
// away. A run starts over it and carries its picks; so does a Retry after a failed run.
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action, operationId?: string) => run(ws, action, operationId).workspace
const today = '2026-10-24', draftOf = (ws: Workspace) => ws.pages.find(p => p.type === 'daily' && p.date === today)!.draft

/** Yesterday with three open tasks, and last night's review: "Prepare tomorrow" made today's draft by rule. */
function lastNight() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-23' })
  const page = ws.pages[0]!, other = page.sections.find(s => s.kind === 'other')!.id
  for (const title of ['plaid PRD', 'link as page', 'daythread bug', 'fourth']) ws = ok(ws, { type: 'add-task', pageId: page.id, sectionId: other, title, plannedOn: '2026-10-23' })
  ws = ok(ws, { type: 'generate-draft', date: today })
  return ws
}
const startRun = (ws: Workspace, runId: string) => ok(ws, { type: 'start-draft-run', date: today, model: 'fake/model', startedAt: '2026-10-24T15:00:00Z' }, runId)
const manifest = (ws: Workspace) => ({ lines: [], sentPages: [], omittedPages: [], taskCandidates: ws.tasks.map(t => t.id), materialCandidates: [] })

test('the review\'s draft is not a card draft: its picks are the evening\'s, and Draft my day may run over it', () => {
  const ws = lastNight(), draft = draftOf(ws)!
  assert.equal(isCardDraft(draft), false)
  assert.equal(draft.taskIds.length, 3)
  assert.deepEqual(eveningPicks(draft), { taskIds: draft.taskIds, materialIds: draft.materialIds })
  const started = startRun(ws, 'r1')
  const card = draftOf(started)!
  assert.equal(card.run?.status, 'drafting')
  assert.deepEqual(card.evening, { taskIds: draft.taskIds, materialIds: draft.materialIds }, 'his evening picks travel with the run')
})

test('the run\'s result keeps the evening picks beside its own; a ready run still refuses a second one', () => {
  let ws = startRun(lastNight(), 'r1')
  const evening = draftOf(ws)!.evening!
  ws = ok(ws, { type: 'record-draft-request', date: today, runId: 'r1', requestHash: 'h', manifest: manifest(ws) })
  const fourth = ws.tasks.find(t => t.title === 'fourth')!.id
  ws = ok(ws, { type: 'set-model-draft', date: today, runId: 'r1', taskIds: [evening.taskIds[0]!, fourth], materialIds: [], proposals: [] })
  const draft = draftOf(ws)!
  assert.deepEqual(draft.evening, evening)
  assert.deepEqual(draft.taskIds, [evening.taskIds[0], fourth], 'the run\'s own picks; the card shows each task once')
  assert.deepEqual(eveningPicks(draft), evening)
  assert.throws(() => startRun(ws, 'r2'), /already has a draft/)
})

test('a failed run, then Retry: the evening picks are still there', () => {
  let ws = startRun(lastNight(), 'r1')
  const evening = draftOf(ws)!.evening!
  ws = ok(ws, { type: 'model-draft-failed', date: today, runId: 'r1', failure: 'unavailable' })
  assert.deepEqual(eveningPicks(draftOf(ws)), evening)
  ws = startRun(ws, 'r2')
  assert.deepEqual(draftOf(ws)!.evening, evening)
  assert.equal(draftOf(ws)!.run?.runId, 'r2')
})

test('the card\'s stand-in with no model key runs over it too, keeps the picks, and stays a card draft', () => {
  const ws = ok(lastNight(), { type: 'generate-draft', date: today, trigger: 'card' })
  const draft = draftOf(ws)!
  assert.equal(isCardDraft(draft), true)
  assert.equal(draft.simulated, true)
  assert.equal(draft.evening?.taskIds.length, 3)
  assert.throws(() => run(ws, { type: 'generate-draft', date: today, trigger: 'card' }), /already has a draft/)
})

test('with no review, a run carries nothing', () => {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-23' })
  ws = startRun(ws, 'r1')
  assert.equal(draftOf(ws)!.evening, undefined)
  assert.deepEqual(eveningPicks(draftOf(ws)), { taskIds: [], materialIds: [] })
})
