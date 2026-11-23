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

test('Ratchet: row move Undo restores prior skips, tag and plan atomically', () => {
  const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun)
  const before = structuredClone(s.h.ws)
  const move = s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: tue, today: sun })
  assert.equal(draftOf(s.h.ws, dayId(sun))!.items.find(i => i.id === 'k')!.via, 'row')
  s.h.run({ type: 'undo', targetOperationId: move.receipt.operationId })
  assert.deepEqual(s.rows(sun).kathy, [sat])
  assert.deepEqual(draftOf(s.h.ws, dayId(sun)), draftOf(before, dayId(sun)))
  assert.equal(plannedOn(s.h.ws, s.kathy), plannedOn(before, s.kathy))
})
test('Ratchet: repeated move refuses without changing the first move', () => {
  const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun)
  s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: tue, today: sun })
  const before = structuredClone(s.h.ws)
  assert.throws(() => s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: fri, today: sun }), /Changed elsewhere/)
  assert.deepEqual(s.h.ws, before)
})
