import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, todo, under, text } from './v2-helpers.ts'
import { draftOf, draftView, skippedDays, type DraftItem } from '../src/domain/day-draft.ts'
import { plannedOn } from '../src/domain/workspace.ts'

// #377 (Brian b1bb8ae5, Lead 937ccf73): a carried to-do he skipped before shows the days on its row. ✕ and Dismiss both
// count, a skip he undid doesn't, the list starts again after he applies or moves the to-do, the days are the drafts' own,
// and only carried to-dos have a list. Thu Oct 15 holds the to-dos; Sat 17, Sun 18, Mon 19 and Tue 20 have drafts.
const thu = '2026-10-15', sat = '2026-10-17', sun = '2026-10-18', mon = '2026-10-19', tue = '2026-10-20', fri = '2026-10-23'

function scene() {
  const h = harness()
  h.day(thu)
  h.save(dayId(thu), d => under(d, 'TODO', todo('r1', 'Kathy app', 'plan', thu), todo('r2', 'Lenny reply', 'plan', thu)))
  const kathy = h.task('Kathy app').id, lenny = h.task('Lenny reply').id
  /** That day's draft: both to-dos carried (k, l) and a to-do the model wrote with the same words as one (n). */
  const draft = (date: string) => {
    h.day(date)
    const items: DraftItem[] = [
      { id: 'k', anchor: '', place: 'after', source: 'model', state: 'open', taskId: kathy },
      { id: 'l', anchor: '', place: 'after', source: 'model', state: 'open', taskId: lenny },
      { id: 'n', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: `nb-${date}`, type: 'task', props: {}, content: [text('Kathy app')], children: [] } },
    ]
    h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [kathy, lenny], items, recipe: 5 })
  }
  const cross = (date: string, ...itemIds: string[]) => h.run({ type: 'skip-draft', pageId: dayId(date), itemIds })
  const dismiss = (date: string) => cross(date, ...draftOf(h.ws, dayId(date))!.items.filter(i => i.state === 'open').map(i => i.id))
  /** The days on each row of that day's draft, as the page draws it. */
  const rows = (date: string) => Object.fromEntries((draftView(h.ws, h.page(dayId(date)))?.items ?? []).map(i => [i.taskId ? (i.taskId === kathy ? 'kathy' : 'lenny') : 'line', i.skipped ?? []]))
  return { h, kathy, lenny, draft, cross, dismiss, rows }
}

test('skipped days: ✕ and Dismiss both count, by the drafts’ own days, oldest first', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun); s.dismiss(sun)
  s.draft(mon)
  assert.deepEqual(s.rows(mon), { kathy: [sat, sun], lenny: [sun], line: [] })
})

test('skipped days: a day he didn’t decide on is not a skip, nor a draft he never opened', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun) // left open: he looked and did nothing
  s.draft(mon)
  assert.deepEqual(s.rows(mon).kathy, [sat])
})

test('skipped days: a skip he undid doesn’t count, by Undo or by the notice’s second Undo', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun)
  const skip = s.cross(sun, 'k')
  s.h.run({ type: 'undo', targetOperationId: skip.receipt.operationId })
  assert.equal(draftOf(s.h.ws, dayId(sun))!.items.find(i => i.id === 'k')!.state, 'open')
  const again = s.cross(sun, 'l')
  s.h.run({ type: 'reopen-draft', pageId: dayId(sun), itemIds: ['l'], skippedBy: again.receipt.operationId, seen: { l: plannedOn(s.h.ws, s.lenny) } })
  s.draft(mon)
  assert.deepEqual(s.rows(mon), { kathy: [sat], lenny: [], line: [] })
})

test('skipped days: applying it starts the list again', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun); s.h.run({ type: 'apply-draft', pageId: dayId(sun), itemIds: ['k'], today: sun })
  s.draft(mon); s.cross(mon, 'k')
  s.draft(tue)
  assert.deepEqual(s.rows(tue).kathy, [mon], 'Sat was before he took it on Sun')
})

test('skipped days: planning it on a day another way (a plan row on that day’s page) starts the list again', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.h.run({ type: 'plan-task', taskId: s.kathy, date: sun, today: sun })
  s.draft(mon)
  assert.deepEqual(s.rows(mon).kathy, [])
})

test('skipped days: moving it from the notice or from the row starts the list again', () => {
  for (const how of ['notice', 'row'] as const) {
    const s = scene()
    s.draft(sat); s.cross(sat, 'k')
    s.draft(sun)
    if (how === 'notice') {
      const seen = { k: plannedOn(s.h.ws, s.kathy) }
      const skip = s.cross(sun, 'k')
      s.h.run({ type: 'snooze-draft', pageId: dayId(sun), itemIds: ['k'], date: mon, today: sun, skippedBy: skip.receipt.operationId, seen })
    } else s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: mon, today: sun })
    s.h.day(mon) // on Mon's page itself
    s.draft(tue); s.cross(tue, 'k')
    s.h.day(fri)
    assert.deepEqual(skippedDays(s.h.ws, fri).get(s.kathy), [tue], how)
  }
})

test('skipped days: a move from a draft starts the list again even after its plan row is gone from that day', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun); s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: mon, today: sun })
  // He takes the row off Monday's page himself before Monday; it's still open, so Tuesday carries it again.
  s.h.save(dayId(mon), d => d.filter(n => n.props?.taskId !== s.kathy), { today: sun })
  assert.equal(plannedOn(s.h.ws, s.kathy), thu)
  s.draft(tue); s.cross(tue, 'k')
  s.h.day(fri)
  assert.deepEqual(skippedDays(s.h.ws, fri).get(s.kathy), [tue])
})

test('skipped days: a past day’s draft lists only the skips before that day', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k')
  s.draft(sun)
  s.draft(mon); s.cross(mon, 'k')
  assert.deepEqual(s.rows(sun).kathy, [sat])
})

test('skipped days: a to-do the model wrote has no list, even in the words of one skipped before', () => {
  const s = scene()
  s.draft(sat); s.cross(sat, 'k', 'n')
  s.draft(sun)
  const line = draftView(s.h.ws, s.h.page(dayId(sun)))!.items.find(i => i.id === 'n')!
  assert.equal(line.skipped, undefined)
  assert.deepEqual([...skippedDays(s.h.ws, sun).keys()], [s.kathy])
})

test('move-draft: skipped here and planned on that day in one write; one Undo takes back both', () => {
  const s = scene()
  s.draft(sun)
  const before = structuredClone(s.h.ws)
  const move = s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: tue, today: sun })
  assert.equal(move.receipt.message, `Moved to ${tue}`)
  const k = draftOf(s.h.ws, dayId(sun))!.items.find(i => i.id === 'k')!
  assert.deepEqual([k.state, k.until, k.via, k.by], ['skipped', tue, 'row', move.receipt.operationId])
  assert.equal(plannedOn(s.h.ws, s.kathy), tue)
  assert.deepEqual(draftView(s.h.ws, s.h.page(dayId(sun)))!.items.map(i => i.id), ['l', 'n'])
  s.h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
  assert.deepEqual(draftOf(s.h.ws, dayId(sun)), draftOf(before, dayId(sun)))
  assert.equal(plannedOn(s.h.ws, s.kathy), plannedOn(before, s.kathy))
})

test('move-draft: refused, with nothing changed, when the suggestion isn’t offered any more or the day isn’t later', () => {
  const s = scene()
  s.draft(sun)
  const refused = (action: Parameters<typeof s.h.run>[0], why: RegExp) => {
    const before = JSON.stringify(s.h.ws.pages)
    assert.throws(() => s.h.run(action), why)
    assert.equal(JSON.stringify(s.h.ws.pages), before)
  }
  refused({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: sun, today: sun }, /Pick a later day/)
  refused({ type: 'move-draft', pageId: dayId(sun), itemId: 'n', date: tue, today: sun }, /Nothing to move/)
  // Skipped already (✕ in another tab), or moved by Another day elsewhere since it was shown.
  s.cross(sun, 'k')
  refused({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: tue, today: sun }, /Changed elsewhere/)
  s.h.run({ type: 'plan-task', taskId: s.lenny, date: fri, today: sun })
  refused({ type: 'move-draft', pageId: dayId(sun), itemId: 'l', date: tue, today: sun }, /Changed elsewhere/)
})
