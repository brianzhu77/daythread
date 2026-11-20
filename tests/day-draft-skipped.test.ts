import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, twoDaysAgo, text, bullet, heading, todo, under } from './v2-helpers.ts'
import { inlineText } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, actedOn, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { addDays } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, itemsFromModel, planPage, type DayDraftRequest, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// B101 (Bumblebee e66cfdc9, Lead d1356d66): a plan written for a day he never used is for the next day he opens.
// Invented words throughout. `today` (Thursday 2026-10-22) is the day being drafted.
const at = (date: string, time = '21:00') => `${date}T${time}:00.000Z`
const system = (req: DayDraftRequest) => req.messages[0]!.content
const sent = (req: DayDraftRequest) => req.messages[1]!.content
const lineId = (req: DayDraftRequest, words: string) => [...req.lines].find(([, n]) => inlineText(n.content).trim() === words)?.[0]
const carry = (req: DayDraftRequest, ...words: string[]): DraftItem[] => {
  let n = 0
  const suggestions: ModelSuggestion[] = words.map(w => ({ anchor: [...req.blocks.keys()][0]!, place: 'after', kind: 'line_todo', taskId: '', lineId: lineId(req, w)!, text: '', why: '' }))
  return itemsFromModel(req, suggestions, () => `i${++n}`)
}

/** A plan for the next day written on `date`'s page, under a heading of his own. */
function planOn(h: ReturnType<typeof harness>, date: string) {
  h.day(date)
  h.save(dayId(date), d => [...d, heading('h', 'Next day'), bullet('b1', text('Pack the bags')), bullet('b2', text('Call the bank'))], { at: at(date) })
}

test('B101: yesterday only opened (its page made from the template, nothing done there): the plan two days ago is for today', () => {
  const h = harness()
  planOn(h, twoDaysAgo)
  h.day(yesterday)
  h.day(today)
  assert.equal(actedOn(h.ws, h.page(dayId(yesterday))), false)
  assert.equal(planPage(h.ws, today)?.id, dayId(twoDaysAgo))
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  assert.match(system(req), /"tomorrow" on the Tuesday 2026-10-20 page means 2026-10-22: the user didn't use 2026-10-21, so what that page plans for the next day, or for one of those days, is still to do and is for 2026-10-22\. On an older page it means a day that has passed\./)
  assert.match(sent(req), /== Day page Tuesday 2026-10-20, last edited 2026-10-20 21:00; the last day the user used before today, so its plan for the next day is for 2026-10-22 ==/)
  // Carried as to-dos in his words, each knowing the line it came from and the day it was written for.
  const items = carry(req, 'Pack the bags', 'Call the bank')
  assert.deepEqual(items.map(i => [i.block?.type, inlineText(i.block!.content), i.from, i.since]), [['task', 'Pack the bags', 'b1', yesterday], ['task', 'Call the bank', 'b2', yesterday]])
  // Stored and shown with that age.
  h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [], items, recipe: DRAFT_RECIPE })
  assert.deepEqual(draftView(h.ws, h.page(dayId(today)))!.items.map(i => i.since), [yesterday, yesterday])
})

test('B101: no page at all for the skipped days, and more than a week of them: the last page he used is still sent and read so', () => {
  const h = harness()
  const long = addDays(today, -10)
  planOn(h, long)
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  assert.ok(lineId(req, 'Pack the bags'), 'the plan page is sent however old')
  assert.match(system(req), new RegExp(`"tomorrow" on the \\w+ ${long} page means ${today}: the user didn't use the days from ${addDays(long, 1)} to ${yesterday}`))
  assert.deepEqual(carry(req, 'Pack the bags').map(i => i.since), [addDays(long, 1)])
  // A page he used in between, older than a week and before the plan page, isn't the plan page.
  const g = harness()
  planOn(g, addDays(today, -12))
  planOn(g, long)
  g.day(today)
  assert.equal(planPage(g.ws, today)?.id, dayId(long))
})

test('B101: a day he did use is the plan page, whether he edited it or only applied or skipped from its draft', () => {
  // Skipped from yesterday's draft, nothing typed: yesterday was used, so the plan for it isn't carried again.
  const h = harness()
  planOn(h, twoDaysAgo)
  h.day(yesterday)
  const line: DraftItem = { id: 'y1', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: 'yb', type: 'task', props: {}, content: [text('Pack the bags')], children: [] } }
  h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], items: [line], recipe: DRAFT_RECIPE })
  h.day(today)
  assert.equal(planPage(h.ws, today)?.id, dayId(twoDaysAgo), 'a draft only made and shown isn\'t use')
  h.run({ type: 'skip-draft', pageId: dayId(yesterday), itemIds: ['y1'] })
  assert.equal(planPage(h.ws, today)?.id, dayId(yesterday))
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  assert.match(system(req), /"tomorrow" on the Wednesday 2026-10-21 page means 2026-10-22; on an older page it means a day that has passed/)
  assert.equal(req.planFor, undefined)
  assert.doesNotMatch(sent(req), /the last day the user used/)
  // Edited: the same.
  const g = harness()
  planOn(g, twoDaysAgo)
  g.day(yesterday)
  g.save(dayId(yesterday), d => [...d, bullet('w', text('Walked'))], { at: at(yesterday) })
  g.day(today)
  assert.equal(planPage(g.ws, today)?.id, dayId(yesterday))
})

test('B101: a normal day reads as before, and a carried line has no age', () => {
  const h = harness()
  planOn(h, yesterday)
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  assert.equal(req.planFor, undefined)
  assert.match(system(req), /"tomorrow" on the Wednesday 2026-10-21 page means 2026-10-22; on an older page it means a day that has passed\./)
  assert.deepEqual(carry(req, 'Pack the bags').map(i => [i.from, i.since]), [['b1', undefined]])
})

/** Yesterday's draft (made before B101 unless `recipe`) and today's both offer the plan line "Pack the bags". */
function twoDrafts(recipe: { yesterday?: number; today?: number; todayFrom?: string } = {}) {
  const h = harness()
  planOn(h, twoDaysAgo)
  h.day(yesterday)
  h.day(today)
  const item = (id: string, from?: string): DraftItem => ({ id, anchor: '', place: 'after', source: 'model', state: 'open', ...(from ? { from } : {}), block: { id: `${id}-b`, type: 'task', props: {}, content: [text('Pack the bags')], children: [] } })
  h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], items: [item('y1', recipe.yesterday ? 'b1' : undefined)], ...(recipe.yesterday ? { recipe: recipe.yesterday } : { recipe: 2 }) })
  h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [], items: [item('t1', recipe.todayFrom ?? 'b1')], recipe: recipe.today ?? DRAFT_RECIPE })
  const shown = (date: string) => draftView(h.ws, h.page(dayId(date)))!.items.map(i => i.id)
  const tasks = () => h.ws.tasks.filter(t => t.title === 'Pack the bags').length
  return { h, shown, tasks }
}

test('B101: applied today, the old draft for the skipped day no longer offers it, and can\'t apply it', () => {
  const { h, shown, tasks } = twoDrafts()
  assert.deepEqual([shown(yesterday), shown(today)], [['y1'], ['t1']])
  h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['t1'], today })
  assert.deepEqual(shown(yesterday), [])
  assert.throws(() => h.run({ type: 'apply-draft', pageId: dayId(yesterday), itemIds: ['y1'], today }), /Nothing to apply/)
  assert.equal(tasks(), 1)
})

test('B101: applied on the old draft first, today\'s draft no longer offers it; skipped today, the old one doesn\'t either', () => {
  const a = twoDrafts()
  a.h.run({ type: 'apply-draft', pageId: dayId(yesterday), itemIds: ['y1'], today })
  assert.deepEqual(a.shown(today), [])
  assert.throws(() => a.h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['t1'], today }), /Nothing to apply/)
  assert.equal(a.tasks(), 1)
  const b = twoDrafts()
  b.h.run({ type: 'skip-draft', pageId: dayId(today), itemIds: ['t1'] })
  assert.deepEqual(b.shown(yesterday), [])
  assert.equal(b.tasks(), 0)
})

test('B101: between two new drafts the line is known by where it came from, so the same words written again aren\'t taken for it', () => {
  const same = twoDrafts({ yesterday: DRAFT_RECIPE })
  same.h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['t1'], today })
  assert.deepEqual(same.shown(yesterday), [])
  const again = twoDrafts({ yesterday: DRAFT_RECIPE, todayFrom: 'written-again' })
  again.h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['t1'], today })
  assert.deepEqual(again.shown(yesterday), ['y1'])
})

const wordsItem = (id: string, from?: string): DraftItem => ({ id, anchor: '', place: 'after', source: 'model', state: 'open', ...(from ? { from } : {}), block: { id: `${id}-b`, type: 'task', props: {}, content: [text('Pack the bags')], children: [] } })
const setDraft = (h: ReturnType<typeof harness>, date: string, items: DraftItem[], recipe: number) => h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [], items, recipe })
const shownOn = (h: ReturnType<typeof harness>, date: string) => draftView(h.ws, h.page(dayId(date)))!.items.map(i => i.id)

test('B101: an old draft opened weeks later doesn\'t offer a line applied since from a newer one (Ratchet 5dd205a3)', () => {
  const h = harness()
  const plan = addDays(today, -12), old = addDays(today, -11)
  planOn(h, plan)
  h.day(old)
  h.day(today)
  setDraft(h, old, [wordsItem('o1')], 2)
  setDraft(h, today, [wordsItem('t1', 'b1')], DRAFT_RECIPE)
  h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['t1'], today })
  assert.deepEqual(shownOn(h, old), [])
  assert.throws(() => h.run({ type: 'apply-draft', pageId: dayId(old), itemIds: ['o1'], today }), /Nothing to apply/)
  assert.equal(h.ws.tasks.filter(t => t.title === 'Pack the bags').length, 1)
})

test('B101: a decision a remake kept from an older draft still counts by its words (Ratchet 5dd205a3)', () => {
  const h = harness()
  planOn(h, twoDaysAgo)
  h.day(yesterday)
  h.day(today)
  setDraft(h, yesterday, [wordsItem('y1')], 2)
  h.run({ type: 'skip-draft', pageId: dayId(yesterday), itemIds: ['y1'] })
  setDraft(h, yesterday, [], DRAFT_RECIPE)
  setDraft(h, today, [wordsItem('t1', 'b1')], DRAFT_RECIPE)
  assert.deepEqual(shownOn(h, today), [])
})

test('B101: the same words written again on a later page aren\'t taken for an old draft\'s line', () => {
  const h = harness()
  h.day(twoDaysAgo)
  h.day(today)
  setDraft(h, twoDaysAgo, [wordsItem('o1')], 2)
  h.run({ type: 'apply-draft', pageId: dayId(twoDaysAgo), itemIds: ['o1'], today: twoDaysAgo })
  // Written again yesterday, after that draft's day: a new line, offered.
  planOn(h, yesterday)
  setDraft(h, today, [wordsItem('t1', 'b1')], DRAFT_RECIPE)
  assert.deepEqual(shownOn(h, today), ['t1'])
})

test('B101: what he wrote down for the day goes first, however the model ordered its answer', () => {
  const h = harness()
  planOn(h, twoDaysAgo)
  h.save(dayId(twoDaysAgo), d => under(d, 'TODO', todo('k1', 'Water the plants', 'plan', twoDaysAgo)), { at: at(twoDaysAgo, '22:00') })
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  const anchor = [...req.blocks.keys()][0]!, k = [...req.tasks].find(([, t]) => t.title === 'Water the plants')![0]
  const s = (kind: ModelSuggestion['kind'], ids: Partial<ModelSuggestion>): ModelSuggestion => ({ anchor, place: 'after', kind, taskId: '', lineId: '', text: '', why: '', ...ids })
  let n = 0
  const items = itemsFromModel(req, [s('line_todo', { lineId: lineId(req, 'Pack the bags')! }), s('existing_todo', { taskId: k }), s('line_todo', { lineId: lineId(req, 'Call the bank')! })], () => `i${++n}`)
  assert.deepEqual(items.map(i => (i.taskId ? 'plants' : inlineText(i.block!.content))), ['Pack the bags', 'Call the bank', 'plants'])
})
