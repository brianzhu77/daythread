import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, twoDaysAgo, text, bullet, heading } from './v2-helpers.ts'
import { inlineText } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, draftOf, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { buildDayDraftRequest, itemsFromModel, runDayDraft, withSkippedPlan, type DayDraftRequest, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// Lead bf60ec67 (Bumblebee 76c5de02): the open to-do lines of a skipped day's draft are in the next draft whatever the
// model answers. Invented words throughout. `today` is drafted; yesterday he never used; the plan was written two days ago.
const at = (date: string) => `${date}T21:00:00.000Z`
const taskBlock = (id: string, words: string): DraftItem['block'] => ({ id, type: 'task', props: {}, content: [text(words)], children: [] })

function skippedDay(recipe = DRAFT_RECIPE, withFrom = true) {
  const h = harness()
  h.day(twoDaysAgo)
  h.save(dayId(twoDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text('Pack the bags')), bullet('b2', text('Call the bank')), bullet('b3', text('Nice view'))], { at: at(twoDaysAgo) })
  h.day(yesterday)
  // Yesterday's draft, made but never acted on: the two plan lines as to-dos, and a plain line.
  const items: DraftItem[] = [
    { id: 'y1', anchor: '', place: 'after', source: 'model', state: 'open', ...(withFrom ? { from: 'b1' } : {}), block: taskBlock('yb1', 'Pack the bags') },
    { id: 'y2', anchor: '', place: 'after', source: 'model', state: 'open', ...(withFrom ? { from: 'b2' } : {}), block: taskBlock('yb2', 'Call the bank') },
    { id: 'y3', anchor: '', place: 'after', source: 'model', state: 'open', ...(withFrom ? { from: 'b3' } : {}), block: { id: 'yb3', type: 'bulletListItem', props: {}, content: [text('Nice view')], children: [] } },
  ]
  h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], items, recipe })
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  let n = 0
  const newId = () => `n${++n}`
  const model = (...list: Partial<ModelSuggestion>[]) => itemsFromModel(req, list.map(s => ({ anchor: [...req.blocks.keys()][0]!, place: 'after', kind: 'line_todo', taskId: '', lineId: '', text: '', why: '', ...s })), newId)
  const lineId = (words: string) => [...req.lines].find(([, x]) => inlineText(x.content).trim() === words)![0]
  const carry = (items: DraftItem[]) => withSkippedPlan(h.ws, h.page(dayId(today)), req, items, newId)
  return { h, req, model, lineId, carry }
}
const read = (items: DraftItem[]) => items.map(i => [inlineText(i.block?.content), i.block?.type, i.from, i.since, i.source])

test('carry: the model carries neither line, or answers nothing: the app carries both, first, as to-dos aged the day he wrote them', () => {
  const s = skippedDay()
  const { items, carried } = s.carry([])
  assert.equal(carried, 2)
  assert.deepEqual(read(items), [['Pack the bags', 'task', 'b1', twoDaysAgo, 'fallback'], ['Call the bank', 'task', 'b2', twoDaysAgo, 'fallback']])
  // And ahead of whatever else the model did suggest; the plain line isn't carried this way.
  const other = s.model({ kind: 'new_todo', text: 'Something else' })
  assert.deepEqual(s.carry(other).items.map(i => inlineText(i.block?.content)), ['Pack the bags', 'Call the bank', 'Something else'])
})

test('carry: the model carries one line: that one stays its item, the other is added, once each, in the order written', () => {
  const s = skippedDay()
  const mine = s.model({ lineId: s.lineId('Call the bank') })
  const { items, carried } = s.carry(mine)
  assert.equal(carried, 1)
  assert.deepEqual(items.map(i => inlineText(i.block?.content)), ['Pack the bags', 'Call the bank'])
  assert.equal(items[1], mine[0], 'the model\'s own item, where it put it')
  // Both: nothing added.
  const both = s.model({ lineId: s.lineId('Pack the bags') }, { lineId: s.lineId('Call the bank') })
  assert.deepEqual(s.carry(both), { items: both, carried: 0 })
  // Carried as a plain line by the model: it becomes the to-do, still where the model put it.
  const plain = s.model({ kind: 'line', lineId: s.lineId('Pack the bags') })
  const fixed = s.carry(plain).items
  assert.deepEqual(read(fixed).slice(0, 1), [['Pack the bags', 'task', 'b1', twoDaysAgo, 'model']])
  assert.equal(fixed[0]!.anchor, plain[0]!.anchor)
})

test('carry: with no model answer at all the draft still holds both lines first', async () => {
  const s = skippedDay()
  const run = await runDayDraft(s.h.ws, s.h.page(dayId(today)), null, () => crypto.randomUUID(), 'UTC')
  assert.equal(run.status, 'failed')
  assert.deepEqual(run.items.slice(0, 2).map(i => inlineText(i.block?.content)), ['Pack the bags', 'Call the bank'])
  assert.deepEqual([run.returned, run.kept, run.carried], [0, 0, 2])
  // Stored, shown and applied as any draft item; one Apply puts them on today's page.
  s.h.run({ type: 'set-draft', pageId: dayId(today), status: run.status, items: run.items, moreOpen: run.moreOpen, allowedTaskIds: run.allowedTaskIds, recipe: DRAFT_RECIPE })
  const shown = draftView(s.h.ws, s.h.page(dayId(today)))!.items
  assert.deepEqual(shown.slice(0, 2).map(i => i.since), [twoDaysAgo, twoDaysAgo])
  s.h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: shown.slice(0, 2).map(i => i.id), today })
  assert.equal(s.h.ws.tasks.filter(t => t.title === 'Pack the bags').length, 1)
})

test('carry: once today\'s draft is stored, the skipped day\'s draft hands its to-do lines on; its plain line stays (Lead 312046f4)', () => {
  for (const [recipe, withFrom] of [[DRAFT_RECIPE, true], [3, true], [2, false]] as const) {
    const s = skippedDay(recipe, withFrom)
    const { items } = s.carry([])
    assert.equal(items[0]!.from, 'b1', 'the line of his it reads as, when the old draft didn\'t keep it')
    assert.deepEqual(draftView(s.h.ws, s.h.page(dayId(yesterday)))!.items.map(i => i.id), ['y1', 'y2', 'y3'], 'not before it is stored')
    s.h.run({ type: 'set-draft', pageId: dayId(today), status: 'failed', items, moreOpen: [], allowedTaskIds: [], recipe: DRAFT_RECIPE })
    assert.deepEqual(draftView(s.h.ws, s.h.page(dayId(yesterday)))!.items.map(i => i.id), ['y3'], `recipe ${recipe}`)
    assert.throws(() => s.h.run({ type: 'apply-draft', pageId: dayId(yesterday), itemIds: ['y1'], today }), /Nothing to apply/)
  }
})

test('carry: nothing is carried from a day he acted on, or a line already decided or on today\'s page', () => {
  // Skipped one line there: the day was used, so its plan isn't carried again.
  const used = skippedDay()
  used.h.run({ type: 'skip-draft', pageId: dayId(yesterday), itemIds: ['y1'] })
  const u = buildDayDraftRequest(used.h.ws, used.h.page(dayId(today)), 'UTC')
  assert.deepEqual(withSkippedPlan(used.h.ws, used.h.page(dayId(today)), u, [], () => 'x'), { items: [], carried: 0 })
  // Already on today's page.
  const on = skippedDay()
  on.h.save(dayId(today), d => [...d, bullet('t', text('Pack the bags'))])
  const r = buildDayDraftRequest(on.h.ws, on.h.page(dayId(today)), 'UTC')
  assert.deepEqual(withSkippedPlan(on.h.ws, on.h.page(dayId(today)), r, [], () => 'x').items.map(i => inlineText(i.block?.content)), ['Call the bank'])
  // Already skipped from another day's draft (#221's not twice).
  const decided = skippedDay()
  decided.h.day('2026-10-19')
  decided.h.run({ type: 'set-draft', pageId: dayId('2026-10-19'), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: DRAFT_RECIPE, items: [{ id: 'o1', anchor: '', place: 'after', source: 'model', state: 'open', from: 'b2', block: taskBlock('ob', 'Call the bank') }] })
  decided.h.run({ type: 'skip-draft', pageId: dayId('2026-10-19'), itemIds: ['o1'] })
  const q = buildDayDraftRequest(decided.h.ws, decided.h.page(dayId(today)), 'UTC')
  assert.deepEqual(withSkippedPlan(decided.h.ws, decided.h.page(dayId(today)), q, [], () => 'x').items.map(i => inlineText(i.block?.content)), ['Pack the bags'])
})

test('carry: the log counts why the model\'s suggestions were left out, never their words', () => {
  const s = skippedDay()
  const drops: Record<string, number> = {}
  itemsFromModel(s.req as DayDraftRequest, [
    { anchor: 'P999', place: 'after', kind: 'line', taskId: '', lineId: '', text: '', why: '' },
    { anchor: [...s.req.blocks.keys()][0]!, place: 'after', kind: 'line', taskId: '', lineId: 'L999', text: '', why: '' },
    { anchor: [...s.req.blocks.keys()][0]!, place: 'after', kind: 'line_todo', taskId: '', lineId: s.lineId('Pack the bags'), text: '', why: '' },
    { anchor: [...s.req.blocks.keys()][0]!, place: 'after', kind: 'new_todo', taskId: '', lineId: '', text: 'pack the bags', why: '' },
    { anchor: [...s.req.blocks.keys()][0]!, place: 'after', kind: 'existing_todo', taskId: 'K999', lineId: '', text: '', why: '' },
  ], () => 'x', drops)
  assert.deepEqual(drops, { 'unknown-anchor': 1, 'unknown-line': 1, repeated: 1, 'not-an-open-todo': 1 })
})
