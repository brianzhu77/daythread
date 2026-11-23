import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, todo, under } from './v2-helpers.ts'
import { draftOf, draftPageId, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { plannedOn } from '../src/domain/workspace.ts'

// Lead 86d6cf83: rollback is one command, so the build live before #377 has to open a draft holding an item the row's
// Another day moved (`move-draft`: skipped, `until`, `via: 'row'`). This file uses nothing newer than that build and
// writes the item as stored JSON, so the same file runs on the old tree (checked on main accd393e) and on this one.
const sun = '2026-10-18', tue = '2026-10-20', mon = '2026-10-19'

function scene() {
  const h = harness()
  h.day('2026-10-15')
  h.save(dayId('2026-10-15'), d => under(d, 'TODO', todo('r1', 'Kathy app', 'plan', '2026-10-15'), todo('r2', 'Lenny reply', 'plan', '2026-10-15')))
  const kathy = h.task('Kathy app').id, lenny = h.task('Lenny reply').id
  h.day(sun)
  h.run({ type: 'set-draft', pageId: dayId(sun), status: 'ready', moreOpen: [], allowedTaskIds: [kathy, lenny], recipe: 5, items: [
    { id: 'k', anchor: '', place: 'after', source: 'model', state: 'open', taskId: kathy },
    { id: 'l', anchor: '', place: 'after', source: 'model', state: 'open', taskId: lenny },
  ] as DraftItem[] })
  // What `move-draft` leaves: planned on Tuesday, and the item skipped with the day, the tag and its write's id.
  h.run({ type: 'plan-task', taskId: kathy, date: tue, today: sun })
  const page = h.ws.pages.find(p => p.id === draftPageId(dayId(sun)))!
  const stored = JSON.parse(page.document)
  stored.items[0] = { ...stored.items[0], state: 'skipped', until: tue, via: 'row', by: 'op-row-move' }
  page.document = JSON.stringify(stored)
  return { h, kathy, lenny }
}

test('old build: a draft holding a row-moved to-do opens, shows the rest, and the moved one stays moved', () => {
  const { h, kathy } = scene()
  const view = draftView(h.ws, h.page(dayId(sun)))!
  assert.equal(view.status, 'ready')
  assert.deepEqual(view.items.map(i => i.id), ['l'])
  assert.equal(plannedOn(h.ws, kathy), tue)
})

test('old build: Apply all, Dismiss and the notice’s writes leave the row-moved to-do as it is', () => {
  const { h, kathy } = scene()
  h.run({ type: 'apply-draft', pageId: dayId(sun), itemIds: ['k', 'l'], today: sun })
  const k = () => draftOf(h.ws, dayId(sun))!.items.find(i => i.id === 'k')!
  assert.deepEqual([k().state, k().until, k().via], ['skipped', tue, 'row'])
  assert.throws(() => h.run({ type: 'skip-draft', pageId: dayId(sun), itemIds: ['k'] }), /Nothing to skip/)
  assert.throws(() => h.run({ type: 'reopen-draft', pageId: dayId(sun), itemIds: ['k'], skippedBy: 'op-row-move', seen: { k: tue } }), /Cannot undo/)
  assert.throws(() => h.run({ type: 'snooze-draft', pageId: dayId(sun), itemIds: ['k'], date: mon, today: sun, skippedBy: 'op-row-move', seen: { k: tue } }), /Changed elsewhere/)
  assert.equal(plannedOn(h.ws, kathy), tue)
})

test('old build: Monday’s draft doesn’t offer it, Wednesday’s does again', () => {
  const { h, kathy, lenny } = scene()
  for (const date of [mon, '2026-10-21']) {
    h.day(date)
    h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [kathy, lenny], recipe: 5, items: [
      { id: 'k', anchor: '', place: 'after', source: 'model', state: 'open', taskId: kathy },
    ] as DraftItem[] })
  }
  assert.deepEqual(draftOf(h.ws, dayId(mon))!.items.map(i => i.taskId), [])
  assert.deepEqual(draftView(h.ws, h.page(dayId('2026-10-21')))!.items.map(i => i.taskId), [kathy])
})
