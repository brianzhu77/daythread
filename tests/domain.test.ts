import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView } from '../src/domain/workspace.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

const today = '2026-10-16', yesterday = '2026-10-15', future = '2026-10-17'
function setup() {
  let state = createEmptyWorkspace(), sequence = 0
  const run = (action: Action, operationId = `test-${++sequence}`) => {
    const result = applyCommand(state, { operationId, expectedRevision: state.revision, action })
    state = result.workspace
    return result
  }
  const day = (date = today) => {
    run({ type: 'ensure-day', date })
    return state.pages.find(p => p.date === date)!
  }
  const add = (date = today, title = 'Read proposal') => {
    const page = day(date)
    run({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(s => s.kind === 'other')!.id,
      title, plannedOn: date, deadlineOn: '2026-10-20', attentionOn: today })
    return state.tasks.at(-1)!
  }
  return { run, day, add, get state() { return state } }
}

test('rescheduling keeps identity, deadline and attention', () => {
  const s = setup(), task = s.add(yesterday)
  s.run({ type: 'plan-task', taskId: task.id, date: today })
  assert.equal(s.state.tasks.length, 1)
  assert.deepEqual([s.state.tasks[0].id, s.state.tasks[0].plannedOn, s.state.tasks[0].deadlineOn, s.state.tasks[0].attentionOn],
    [task.id, today, '2026-10-20', today])
})
test('Not today pauses carry but preserves dates unrelated to that placement', () => {
  const s = setup(), task = s.add(today)
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  s.run({ type: 'not-today', taskId: task.id, date: today })
  const result = s.state.tasks[0]
  assert.equal(result.plannedOn, future)
  assert.equal(result.deadlineOn, '2026-10-20')
  assert.equal(result.attentionOn, today)
  assert.equal(result.paused, true)
})
test('explicit planning reactivates excluded task on the same day', () => {
  const s = setup(), task = s.add()
  s.run({ type: 'not-today', taskId: task.id, date: today })
  s.run({ type: 'plan-task', taskId: task.id, date: today })
  assert.equal(s.state.tasks[0].paused, false)
  assert.equal(getDayView(s.state, today).planned.filter(t => t.id === task.id).length, 1)
})
test('Keep task retains Task identity and operation replay is harmless', () => {
  const s = setup(), task = s.add(yesterday), page = s.state.pages.find(p => p.date === yesterday)!
  const block = page.sections.flatMap(x => x.blocks).find(b => b.taskId === task.id)!
  s.day()
  const action: Action = { type: 'keep-block', sourcePageId: page.id, blockId: block.id, targetDate: today }
  s.run(action, 'keep-once')
  const before = structuredClone(s.state)
  s.run(action, 'keep-once')
  assert.deepEqual(s.state, before)
  assert.equal(s.state.tasks.length, 1)
  assert.equal(s.state.tasks[0].id, task.id)
})
test('ordinary prose Bring copies text and provenance without creating Task', () => {
  const s = setup(), page = s.day(yesterday), section = page.sections.find(x => x.kind === 'notes')!
  s.run({ type: 'add-text', pageId: page.id, sectionId: section.id, text: 'Remember the interesting paragraph' })
  const block = s.state.pages.find(p => p.id === page.id)!.sections.flatMap(x => x.blocks).at(-1)!
  s.day()
  s.run({ type: 'keep-block', sourcePageId: page.id, blockId: block.id, targetDate: today })
  const copies = s.state.pages.find(p => p.date === today)!.sections.flatMap(x => x.blocks)
  assert.ok(copies.some(b => b.text === block.text && b.sourcePageId === page.id && b.sourceBlockId === block.id))
  assert.equal(s.state.tasks.length, 0)
})
test('yesterday handoff is uncapped and does not include completed tasks', () => {
  const s = setup()
  for (let i = 0; i < 6; i++) s.add(yesterday, `Task ${i}`)
  s.run({ type: 'task-status', taskId: s.state.tasks[5].id, status: 'done' })
  s.day()
  assert.equal(getDayView(s.state, today).handoffTasks.length, 5)
})
test('undated open task remains findable in pool', () => {
  const s = setup(), page = s.day()
  s.run({ type: 'add-task', pageId: page.id, sectionId: page.sections[0].id, title: 'Unscheduled', plannedOn: null })
  assert.ok(getDayView(s.state, today).openPool.some(t => t.title === 'Unscheduled'))
})
test('reflection saves without drafting or creating tasks', () => {
  const s = setup(); s.day()
  s.run({ type: 'save-review', date: today, text: 'Tomorrow cancel everything', finish: true })
  const page = s.state.pages.find(p => p.date === today)!
  assert.equal(page.reviewSaved, true)
  assert.equal(page.draft, null)
  assert.equal(s.state.tasks.length, 0)
})
test('stale workspace command rejects without mutating input', () => {
  const s = setup(); s.day()
  const before = structuredClone(s.state)
  assert.throws(() => applyCommand(s.state, { operationId: 'stale', expectedRevision: 0,
    action: { type: 'handoff-done', date: today } }))
  assert.deepEqual(s.state, before)
})
test('exact URL reuse keeps one Material and independent annotations', () => {
  const s = setup(), page = s.day(), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  for (const note of ['First context', 'Second context']) s.run({ type: 'save-material', pageId: page.id, sectionId,
    url: 'https://example.com/a?ref=one', title: 'Resource', note })
  assert.equal(s.state.materials.length, 1)
  assert.deepEqual(s.state.materials[0].sources.map(x => x.note).sort(), ['First context', 'Second context'])
})

test('current plan deletion pauses but bulk deletion only removes presentation', () => {
  for (const bulk of [false, true]) {
    const s = setup(), task = s.add(), page = s.state.pages.find(p => p.date === today)!
    const block = page.sections.flatMap(x => x.blocks).find(b => b.taskId === task.id)!
    s.run({ type: 'remove-blocks', pageId: page.id, blockIds: [block.id], bulk, today })
    assert.equal(s.state.tasks[0].paused, !bulk)
    assert.equal(s.state.tasks[0].deadlineOn, '2026-10-20')
    if (bulk) assert.equal(s.state.tasks[0].plannedOn, today)
  }
})
test('historical plan presentation deletion does not pause current task', () => {
  const s = setup(), task = s.add(yesterday), page = s.state.pages.find(p => p.date === yesterday)!
  const block = page.sections.flatMap(x => x.blocks).find(b => b.taskId === task.id)!
  s.run({ type: 'plan-task', taskId: task.id, date: today })
  s.run({ type: 'remove-blocks', pageId: page.id, blockIds: [block.id], bulk: false, today })
  assert.equal(s.state.tasks[0].paused, false)
  assert.equal(s.state.tasks[0].plannedOn, today)
})
test('undo of Not today restores original state rather than unconditional unpause', () => {
  const s = setup(), task = s.add()
  s.run({ type: 'not-today', taskId: task.id, date: today }, 'pause-original')
  const before = structuredClone(s.state.tasks[0])
  s.run({ type: 'not-today', taskId: task.id, date: today }, 'pause-again')
  s.run({ type: 'undo', targetOperationId: 'pause-again' })
  assert.equal(s.state.tasks[0].paused, before.paused)
  assert.equal(s.state.tasks[0].plannedOn, before.plannedOn)
})
test('discarding a pending proposal leaves tasks unchanged and raw input retained', () => {
  const state = createEmptyWorkspace()
  state.captures.push({ id: 'capture-1', pageId: 'day-1', text: 'Change existing commitment',
    status: 'needs_confirmation', proposalRevision: 1, simulated: true, proposedTitle: 'Changed title' })
  const result = applyCommand(state, { operationId: 'discard', expectedRevision: 0,
    action: { type: 'discard-capture', captureId: 'capture-1' } }).workspace
  assert.equal(result.tasks.length, 0)
  assert.equal(result.captures[0].text, 'Change existing commitment')
  assert.equal(result.captures[0].status, 'discarded')
})
test('stale proposal revision cannot be applied', () => {
  const state = createEmptyWorkspace()
  state.captures.push({ id: 'capture-1', pageId: 'day-1', text: 'A commitment',
    status: 'needs_confirmation', proposalRevision: 2, simulated: true, proposedTitle: 'Edited title' })
  const before = structuredClone(state)
  assert.throws(() => applyCommand(state, { operationId: 'apply-stale', expectedRevision: 0,
    action: { type: 'apply-capture', captureId: 'capture-1', proposalRevision: 1 } }))
  assert.deepEqual(state, before)
})

test('G01/G02 material review starts after two days and caps at three', () => {
  const s = setup(), page = s.day('2026-10-12'), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  for (let i = 0; i < 5; i++) s.run({ type: 'save-material', pageId: page.id, sectionId, url: `https://example.com/${i}`, title: `Item ${i}` })
  assert.equal(getDayView(s.state, '2026-10-12').materialReview.length, 0)
  assert.equal(getDayView(s.state, '2026-10-14').materialReview.length, 3)
  s.run({ type: 'material-resurface', materialId: s.state.materials[0].id, enabled: false })
  assert.ok(!getDayView(s.state, '2026-10-14').materialReview.some(m => m.id === s.state.materials[0].id))
})
test('G03/G04 watching returns in seven days; lower stays out; Undo restores', () => {
  const s = setup(), page = s.day('2026-10-12'), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  s.run({ type: 'save-material', pageId: page.id, sectionId, url: 'https://example.com/a', title: 'A' })
  const id = s.state.materials[0].id
  s.run({ type: 'review-material', materialId: id, decision: 'watching', date: '2026-10-14' })
  assert.equal(getDayView(s.state, '2026-10-15').materialReview.length, 0)
  assert.equal(getDayView(s.state, '2026-10-21').materialReview.length, 1)
  s.run({ type: 'review-material', materialId: id, decision: 'lower', date: '2026-10-21' }, 'lower')
  assert.equal(getDayView(s.state, '2026-10-22').materialReview.length, 0)
  s.run({ type: 'undo', targetOperationId: 'lower' })
  assert.equal(s.state.materials[0].reviewState, 'watching')
})
test('G05 saving a Done URL reopens one Material and keeps both sources', () => {
  const s = setup(), page = s.day(), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  const save: Action = { type: 'save-material', pageId: page.id, sectionId, url: 'https://example.com/a', title: 'A' }
  s.run(save)
  s.run({ type: 'review-material', materialId: s.state.materials[0].id, decision: 'done', date: today })
  s.run(save)
  assert.equal(s.state.materials.length, 1)
  assert.equal(s.state.materials[0].reviewState, 'pending')
  assert.equal(s.state.materials[0].sources.length, 2)
})
test('G06 Make task is idempotent even with a new transport operation ID', () => {
  const s = setup(), page = s.day(), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  s.run({ type: 'save-material', pageId: page.id, sectionId, url: 'https://example.com/a', title: 'A' })
  const action: Action = { type: 'review-material', materialId: s.state.materials[0].id, decision: 'task', date: today }
  s.run(action); s.run(action)
  assert.equal(s.state.tasks.length, 1)
  assert.equal(s.state.tasks[0].plannedOn, null)
  assert.equal(s.state.materials[0].taskId, s.state.tasks[0].id)
  assert.equal(getDayView(s.state, future).materialReview.length, 0)
})
test('G07 skip affects only shown cards for three days and never saves review', () => {
  const s = setup(), page = s.day('2026-10-12'), sectionId = page.sections.find(x => x.kind === 'good-stuffs')!.id
  for (let i = 0; i < 5; i++) s.run({ type: 'save-material', pageId: page.id, sectionId, url: `https://example.com/${i}`, title: `Item ${i}` })
  s.day('2026-10-14')
  const shown = getDayView(s.state, '2026-10-14').materialReview.map(m => m.id)
  s.run({ type: 'skip-material-review', materialIds: shown, date: '2026-10-14' })
  assert.equal(getDayView(s.state, '2026-10-15').materialReview.length, 2)
  assert.ok(getDayView(s.state, '2026-10-15').materialReview.every(m => !shown.includes(m.id)))
  assert.equal(getDayView(s.state, '2026-10-17').materialReview.length, 3)
  assert.equal(s.state.pages.find(p => p.date === '2026-10-14')!.reviewSaved, false)
})
test('mixed capture applies neither part on stale existing Task version', () => {
  const s = setup(), task = s.add(), page = s.state.pages.find(p => p.date === today)!
  s.run({ type: 'capture', pageId: page.id, text: 'New task and finish old task', updateTaskId: task.id })
  const capture = s.state.captures[0]
  assert.equal(s.state.tasks.length, 1)
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  const before = structuredClone(s.state)
  assert.throws(() => s.run({ type: 'apply-capture', captureId: capture.id, proposalRevision: 1 }))
  assert.deepEqual(s.state, before)
})
test('mixed capture removal of mutation still waits; replay creates only one task', () => {
  const s = setup(), task = s.add(), page = s.state.pages.find(p => p.date === today)!
  s.run({ type: 'capture', pageId: page.id, text: 'New task and finish old task', updateTaskId: task.id })
  const capture = s.state.captures[0], mutation = capture.proposals!.find(p => p.kind === 'update-task')!
  s.run({ type: 'edit-capture', captureId: capture.id, proposalRevision: 1, title: 'New task', removeItemId: mutation.id })
  assert.equal(s.state.tasks.length, 1)
  assert.equal(s.state.captures[0].status, 'needs_confirmation')
  const apply: Action = { type: 'apply-capture', captureId: capture.id, proposalRevision: 2 }
  s.run(apply); s.run(apply)
  assert.equal(s.state.tasks.length, 2)
  assert.equal(s.state.tasks.find(t => t.id === task.id)!.status, 'open')
})
test('yesterday handoff survives presentation-only bulk deletion without capping five commitments', () => {
  const s = setup()
  for (let i = 0; i < 5; i++) s.add(yesterday, `Commitment ${i}`)
  const page = s.state.pages.find(p => p.date === yesterday)!
  const ids = page.sections.flatMap(x => x.blocks).filter(b => b.taskId).map(b => b.id)
  s.run({ type: 'remove-blocks', pageId: page.id, blockIds: ids, bulk: true, today: yesterday })
  s.day()
  assert.equal(getDayView(s.state, today).handoffTasks.length, 5)
})
