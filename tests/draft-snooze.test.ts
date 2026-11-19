import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, todo, para, heading, text, nodesOf, under } from './v2-helpers.ts'
import { draftOf, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, withFallback } from '../src/server/model/day-draft.ts'

// Brian 17e7b7f2, Lead d2d043f0: from the day's draft, a suggested to-do can be moved to a later day. It is planned
// there, and no draft before that day offers it again: not the model's input, not its answer, not a draft already made.
const monday = '2026-10-26' // tomorrow is Fri Oct 23

function setup() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('p', 'Plan'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', ''), heading('n', 'Notes'), para('nn')])
  const day = h.day(tomorrow)
  const slot = nodesOf(day).find(n => n.type === 'task')!.id
  const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
  const draft = (items: Partial<DraftItem>[], moreOpen: string[] = [], pageId = dayId(tomorrow)) => h.run({
    type: 'set-draft', pageId, status: 'ready', moreOpen, allowedTaskIds: [book, dog],
    items: items.map((x, i) => ({ id: `i${i}`, anchor: slot, place: 'after', source: 'model', state: 'open', ...x }) as DraftItem),
  })
  const item = (id: string) => draftOf(h.ws, dayId(tomorrow))!.items.find(i => i.id === id)!
  const view = () => draftView(h.ws, h.page(dayId(tomorrow)))!
  /** What the notice saw when it was shown: each to-do item's planned day (the hook's DraftTicket). */
  const seenNow = (): Record<string, string | null> => Object.fromEntries(draftOf(h.ws, dayId(tomorrow))!.items.flatMap(i => (i.taskId ? [[i.id, plannedOn(h.ws, i.taskId)]] : [])))
  return { h, book, dog, draft, item, view, seenNow }
}
const line = (words: string) => ({ block: para('w', text(words)) })

test('snooze: a to-do planned for a later day is not sent to the model, nor listed under more open, until that day', () => {
  const { h, book, dog } = setup()
  h.run({ type: 'plan-task', taskId: book, date: monday, today: tomorrow })
  const req = buildDayDraftRequest(h.ws, h.page(dayId(tomorrow)))
  assert.deepEqual([...req.tasks.values()].map(t => t.id), [dog])
  assert.ok(!withFallback(h.ws, h.page(dayId(tomorrow)), [], () => 'x').moreOpen.includes(book))
  // On Monday it's on the page itself; the day after, it is offered again like any open to-do.
  h.day('2026-10-27')
  assert.ok([...buildDayDraftRequest(h.ws, h.page(dayId('2026-10-27'))).tasks.values()].some(t => t.id === book))
})

test('snooze: an answer to an older ask, stored after the move, cannot bring the to-do back', () => {
  const { h, book, dog, draft, view } = setup()
  h.run({ type: 'plan-task', taskId: book, date: monday, today: tomorrow })
  draft([{ taskId: book }, { taskId: dog }], [book, dog])
  const stored = draftOf(h.ws, dayId(tomorrow))!
  assert.deepEqual(stored.items.map(i => i.taskId), [dog])
  assert.deepEqual(stored.moreOpen, [dog])
  assert.deepEqual(view().items.map(i => i.taskId), [dog])
})

test('snooze: a draft made before the move (another tab, another device) stops showing and applying it', () => {
  const { h, book, dog, draft, view, item } = setup()
  draft([{ taskId: book }, { taskId: dog }], [book])
  assert.equal(view().items.length, 2)
  h.run({ type: 'plan-task', taskId: book, date: monday, today: tomorrow })
  assert.deepEqual(view().items.map(i => i.taskId), [dog])
  assert.deepEqual(view().moreOpen, [])
  assert.throws(() => h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0'], today: tomorrow }), /Nothing to apply/)
  assert.equal(plannedOn(h.ws, book), monday, 'Apply never pulls it back to today')
  assert.equal(item('i0').state, 'open')
})

test('snooze: the real flow — ✕, Move to Monday, Undo move, Undo skip — each step leaves what the notice says', () => {
  const { h, book, dog, draft, view, item, seenNow } = setup()
  draft([{ taskId: book }, { taskId: dog }])
  const seen = seenNow()
  const plannedBefore = plannedOn(h.ws, book)
  const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
  const move = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen })
  assert.equal(move.receipt.message, `Moved to ${monday}`)
  assert.equal(plannedOn(h.ws, book), monday)
  assert.ok(nodesOf(h.page(dayId(monday))).some(n => n.props?.taskId === book && n.props?.role === 'plan'), 'a to-do on Monday’s page')
  assert.deepEqual([item('i0').state, item('i0').until], ['skipped', monday])
  assert.deepEqual(view().items.map(i => i.taskId), [dog])
  // Undo move: the plan goes back to what it was, and the suggestion stays skipped for today.
  h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
  assert.equal(plannedOn(h.ws, book), plannedBefore)
  assert.ok(!h.ws.pages.some(p => p.id === dayId(monday)), 'no Monday page left behind')
  assert.deepEqual([item('i0').state, item('i0').until], ['skipped', undefined])
  // The workspace's one Undo is used; the notice's second Undo reopens what the skip left.
  assert.throws(() => h.run({ type: 'undo', targetOperationId: skip.receipt.operationId }), /Cannot undo/)
  h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen })
  assert.equal(item('i0').state, 'open')
  assert.deepEqual(view().items.map(i => i.taskId), [book, dog])
})

test('snooze: one Undo of a move made straight from an open item (Dismiss all) puts the suggestion back too', () => {
  const { h, book, draft, item, seenNow } = setup()
  draft([{ taskId: book }])
  const seen = seenNow()
  const move = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen })
  h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
  assert.equal(item('i0').state, 'open')
  assert.notEqual(plannedOn(h.ws, book), monday)
})

test('snooze: Dismiss all with lines moves only the to-dos; a line has no day; only later days', () => {
  const { h, book, draft, item, seenNow } = setup()
  draft([{ taskId: book }, line('Call the bank')])
  const seen = seenNow()
  h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'] })
  const r = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], date: monday, today: tomorrow, seen })
  assert.equal(r.receipt.message, `Moved to ${monday}`)
  assert.deepEqual([item('i1').state, item('i1').until], ['skipped', undefined])
  assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i1'], date: monday, today: tomorrow, seen }), /Nothing to move/)
  for (const date of [tomorrow, today]) assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date, today: tomorrow, seen }), /Pick a later day/)
})

test('snooze: a to-do done or paused since the draft was shown is not moved', () => {
  const { h, book, dog, draft, seenNow } = setup()
  draft([{ taskId: book }, { taskId: dog }])
  const seen = seenNow()
  h.run({ type: 'task-status', taskId: book, status: 'done', today: tomorrow })
  h.run({ type: 'not-today', taskId: dog, date: today })
  assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], date: monday, today: tomorrow, seen }), /Nothing to move/)
})

test('snooze: the second Undo refuses once another tab or device has decided on the item since', () => {
  // Moved elsewhere after the skip.
  {
    const { h, book, draft, item, seenNow } = setup()
    draft([{ taskId: book }])
    const seen = seenNow()
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen })
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen }), /Cannot undo/)
    assert.equal(item('i0').until, monday)
  }
  // Undo move here, then another tab brings it back and skips it again: the old notice's Undo is stale.
  {
    const { h, book, draft, item, seenNow } = setup()
    draft([{ taskId: book }])
    const seen = seenNow()
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    const move = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen })
    h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
    h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen })
    const again = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen }), /Cannot undo/)
    assert.equal(item('i0').by, again.receipt.operationId)
  }
  // Applied since.
  {
    const { h, book, draft, seenNow } = setup()
    draft([{ taskId: book }])
    const seen = seenNow()
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen })
    h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0'], today: tomorrow })
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen }), /Cannot undo/)
  }
  // A skip from before this build has no stamp: nothing to match, so it refuses rather than guess.
  {
    const { h, book, draft, item, seenNow } = setup()
    draft([{ taskId: book, state: 'skipped' }])
    const seen = seenNow()
    assert.equal(item('i0').state, 'open', 'set-draft stores items open')
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    const p = h.ws.pages.find(x => x.id === `draft:${dayId(tomorrow)}`)!
    const d = JSON.parse(p.document); delete d.items[0].by; p.document = JSON.stringify(d)
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen }), /Cannot undo/)
  }
})

test('snooze: Another day in another tab after ✕ — the old notice neither moves it back nor reopens it (Ratchet da1ca677)', () => {
  // After Undo move.
  {
    const { h, book, draft, item, seenNow } = setup()
    draft([{ taskId: book }])
    const seen = seenNow()
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    const move = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen })
    h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
    h.run({ type: 'plan-task', taskId: book, date: '2026-10-28', today: tomorrow })
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen }), /Cannot undo/)
    assert.equal(item('i0').state, 'skipped')
    assert.equal(plannedOn(h.ws, book), '2026-10-28')
  }
  // Before any move: the old notice's Move to leaves the newer plan.
  {
    const { h, book, draft, item, seenNow } = setup()
    draft([{ taskId: book }])
    const seen = seenNow()
    h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    h.run({ type: 'plan-task', taskId: book, date: '2026-10-28', today: tomorrow })
    assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen }), /Changed elsewhere since/)
    assert.equal(plannedOn(h.ws, book), '2026-10-28')
    assert.equal(item('i0').until, undefined)
  }
  // Dismiss all: the one changed elsewhere stays, the other moves.
  {
    const { h, book, dog, draft, item, seenNow } = setup()
    draft([{ taskId: book }, { taskId: dog }])
    const seen = seenNow()
    h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'] })
    h.run({ type: 'plan-task', taskId: book, date: '2026-10-28', today: tomorrow })
    const r = h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], date: monday, today: tomorrow, seen })
    assert.equal(r.receipt.message, `Moved to ${monday}`)
    assert.deepEqual([plannedOn(h.ws, book), plannedOn(h.ws, dog)], ['2026-10-28', monday])
    assert.deepEqual([item('i0').until, item('i1').until], [undefined, monday])
  }
  // No snapshot for an item: not known, so not moved and not reopened.
  {
    const { h, book, draft } = setup()
    draft([{ taskId: book }])
    const skip = h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
    assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(tomorrow), itemIds: ['i0'], date: monday, today: tomorrow, seen: {} }), /Changed elsewhere since/)
    assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(tomorrow), itemIds: ['i0'], skippedBy: skip.receipt.operationId, seen: {} }), /Cannot undo/)
  }
})
