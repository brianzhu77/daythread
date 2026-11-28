// The day draft's commands as the web sends them (docs/design/native-phase-1.md §13.8): the key order is the wire's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, todo, under, text } from './v2-helpers.ts'
import { applyDraftAction, draftTicket, reopenDraftAction, skipDraftAction } from '../src/components/draft-actions.ts'
import type { DraftItem } from '../src/domain/day-draft.ts'

const TODAY = '2026-11-26', YESTERDAY = '2026-11-25', page = dayId(TODAY)

test('applyDraftAction and skipDraftAction keep the web key order, with edits before today when given', () => {
  assert.equal(JSON.stringify(applyDraftAction(page, ['i1'], TODAY)), '{"type":"apply-draft","pageId":"day:2026-11-26","itemIds":["i1"],"today":"2026-11-26"}')
  assert.equal(JSON.stringify(applyDraftAction(page, ['i1'], TODAY, { i1: 'Call the vet at 9' })), '{"type":"apply-draft","pageId":"day:2026-11-26","itemIds":["i1"],"edits":{"i1":"Call the vet at 9"},"today":"2026-11-26"}')
  assert.equal(JSON.stringify(skipDraftAction(page, ['i1', 'i2'])), '{"type":"skip-draft","pageId":"day:2026-11-26","itemIds":["i1","i2"]}')
})

test('draftTicket keys seen by item, only for to-do items, in the draft\'s order, null for one not planned', () => {
  const h = harness()
  h.day(YESTERDAY)
  h.save(dayId(YESTERDAY), d => under(d, 'TODO', todo('r1', 'Book the flights', 'plan', YESTERDAY)), { today: YESTERDAY, at: '2026-11-25T09:00:00.000Z' })
  h.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' })
  h.save('errands', d => [...d, todo('e1', 'Buy a dog bed', 'plan', '')], { today: TODAY, at: '2026-11-26T08:00:00.000Z' })
  h.day(TODAY)
  const flights = h.task('Book the flights').id, bed = h.task('Buy a dog bed').id
  const items: DraftItem[] = [
    { id: 'i1', anchor: '', place: 'after', source: 'model', state: 'open', taskId: flights },
    { id: 'i2', anchor: '', place: 'after', source: 'model', state: 'open', taskId: bed },
    { id: 'i3', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: 'b3', type: 'bulletListItem', props: {}, content: [text('Stretch')], children: [] } },
  ]
  h.run({ type: 'set-draft', pageId: page, status: 'ready', moreOpen: [], allowedTaskIds: [flights, bed], items })
  const ticket = draftTicket(h.ws, page, ['i3', 'i2', 'i1'], 'op')
  assert.equal(JSON.stringify(ticket), '{"itemIds":["i3","i2","i1"],"skippedBy":"op","seen":{"i1":"2026-11-25","i2":null}}')
  assert.deepEqual(draftTicket(h.ws, page, ['i3'], 'op').seen, {}, 'a line has no key')
  assert.deepEqual(draftTicket(h.ws, 'day:2026-11-27', ['i1'], 'op').seen, {}, 'no draft, no keys')
})

test('reopenDraftAction names the skip and what its notice saw, skippedBy and seen last', () => {
  const ticket = { itemIds: ['i1', 'i2', 'i3'], skippedBy: 'op', seen: { i1: '2026-11-25', i2: null } }
  assert.equal(JSON.stringify(reopenDraftAction(page, ticket)), '{"type":"reopen-draft","pageId":"day:2026-11-26","itemIds":["i1","i2","i3"],"skippedBy":"op","seen":{"i1":"2026-11-25","i2":null}}')
})
