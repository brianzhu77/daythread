import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, twoDaysAgo, text, bullet, heading, todo, under } from './v2-helpers.ts'
import { inlineText } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { addDays } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, itemsFromModel, withSkippedPlan, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// Lead 312046f4: one sweep over every way a carried plan line can sit in the new draft, against the skipped day's old
// draft. The rule: at most one to-do of it, and once one draft has applied or skipped it the other doesn't offer it.
// Invented words. Two days ago he wrote "Pack the bags" for the next day; yesterday he never acted on; today is drafted.
const WORDS = 'Pack the bags'
type How = 'line_todo' | 'line' | 'new_todo' | 'existing' | 'app'
type Tap = ['new' | 'old', 'apply' | 'skip']
const TAPS: Tap[][] = [[['new', 'apply'], ['old', 'apply']], [['new', 'skip'], ['old', 'apply']], [['old', 'apply'], ['new', 'apply']], [['old', 'apply'], ['new', 'skip']]]

function scene(how: How, oldRecipe: number, sourceGone: boolean, taps: Tap[]) {
  const h = harness()
  h.day(twoDaysAgo)
  h.save(dayId(twoDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text(sourceGone ? 'Something else' : WORDS))], { at: `${twoDaysAgo}T21:00:00.000Z` })
  // The existing open to-do of the same words, on a day page of its own.
  if (how === 'existing') { h.day(addDays(today, -5)); h.save(dayId(addDays(today, -5)), d => under(d, 'TODO', todo('k', WORDS, 'plan', addDays(today, -5)))) }
  h.day(yesterday)
  const old: DraftItem = { id: 'old', anchor: '', place: 'after', source: 'model', state: 'open', ...(oldRecipe >= 3 ? { from: 'b1' } : {}), block: { id: 'ob', type: 'task', props: {}, content: [text(WORDS)], children: [] } }
  h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], items: [old], recipe: oldRecipe })
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  const anchor = [...req.blocks.keys()][0]!
  const lineId = [...req.lines].find(([, n]) => inlineText(n.content).trim() === WORDS)?.[0] ?? ''
  const k = [...req.tasks].find(([, t]) => t.title === WORDS)?.[0] ?? ''
  const s = (x: Partial<ModelSuggestion>): ModelSuggestion => ({ anchor, place: 'after', kind: 'line_todo', taskId: '', lineId: '', text: '', why: '', ...x })
  const answer: ModelSuggestion[] = how === 'line_todo' ? [s({ lineId })] : how === 'line' ? [s({ kind: 'line', lineId })] : how === 'new_todo' ? [s({ kind: 'new_todo', text: WORDS })] : how === 'existing' ? [s({ kind: 'existing_todo', taskId: k })] : []
  let n = 0
  const newId = () => `n${++n}`
  const { items } = withSkippedPlan(h.ws, h.page(dayId(today)), req, itemsFromModel(req, answer, newId), newId)
  h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [...req.tasks.values()].map(t => t.id), items, recipe: DRAFT_RECIPE })
  const existing = h.ws.tasks.find(t => t.title === WORDS)?.id
  /** The draft's offered item for the line: its words, or the existing to-do. */
  const offered = (date: string) => draftView(h.ws, h.page(dayId(date)))!.items.find(i => (existing && i.taskId === existing) || inlineText(i.block.content).trim() === WORDS)
  const heldAtFirst = Boolean(offered(today))
  const log: string[] = []
  let decided: 'new' | 'old' | null = null
  for (const [which, act] of taps) {
    const date = which === 'new' ? today : yesterday
    const item = offered(date)
    if (decided && decided !== which) assert.equal(item, undefined, `${which} still offers it after ${decided} decided it`)
    if (!item) { log.push(`${which} ${act}: not offered`); continue }
    h.run(act === 'apply' ? { type: 'apply-draft', pageId: dayId(date), itemIds: [item.id], today } : { type: 'skip-draft', pageId: dayId(date), itemIds: [item.id] })
    decided ??= which
    log.push(`${which} ${act}`)
  }
  return { tasks: h.ws.tasks.filter(t => t.title === WORDS).length, log, heldAtFirst }
}

test('not twice: every way the line sits in the new draft × old draft recipe 2, 3, 4 × source kept or gone × tap orders', () => {
  let runs = 0
  for (const how of ['line_todo', 'line', 'new_todo', 'existing', 'app'] as How[]) {
    for (const oldRecipe of [2, 3, 4]) {
      for (const sourceGone of [false, true]) {
        // A line the model points at must still be there to point at.
        if (sourceGone && (how === 'line_todo' || how === 'line')) continue
        for (const taps of TAPS) {
          runs++
          const r = scene(how, oldRecipe, sourceGone, taps)
          const label = `${how} recipe ${oldRecipe}${sourceGone ? ' source gone' : ''}: ${r.log.join(', ')}`
          assert.ok(r.tasks <= 1, `${label}: ${r.tasks} to-dos`)
          // The new draft holds it, whatever the model answered.
          assert.ok(r.heldAtFirst, `${label}: today's draft lost it`)
          // The skipped day's draft handed it on as soon as today's was stored.
          assert.match(r.log.find(l => l.startsWith('old')) ?? '', /not offered/, label)
        }
      }
    }
  }
  assert.equal(runs, 96)
})

test('not twice: an acted day with the carried line left open keeps offering it there; the next day doesn\'t carry it again (Bumblebee 70a4915b)', () => {
  const h = harness()
  h.day(twoDaysAgo)
  h.save(dayId(twoDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text(WORDS))], { at: `${twoDaysAgo}T21:00:00.000Z` })
  h.day(yesterday)
  h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: DRAFT_RECIPE, items: [
    { id: 'y1', anchor: '', place: 'after', source: 'fallback', state: 'open', from: 'b1', block: { id: 'yb', type: 'task', props: {}, content: [text(WORDS)], children: [] } },
  ] })
  // He acts on yesterday (an edit), leaving the carried line open.
  h.save(dayId(yesterday), d => [...d, bullet('w', text('Walked'))], { at: `${yesterday}T09:00:00.000Z` })
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  assert.deepEqual(withSkippedPlan(h.ws, h.page(dayId(today)), req, [], () => 'x'), { items: [], carried: 0 })
  h.run({ type: 'set-draft', pageId: dayId(today), status: 'failed', moreOpen: [], allowedTaskIds: [], items: [], recipe: DRAFT_RECIPE })
  assert.deepEqual(draftView(h.ws, h.page(dayId(yesterday)))!.items.map(i => i.id), ['y1'], 'still offered on the day he used')
})
