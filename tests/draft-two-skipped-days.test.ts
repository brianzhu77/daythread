import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, twoDaysAgo, text, bullet, heading } from './v2-helpers.ts'
import { inlineText } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, actedOn, draftOf, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { addDays } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, itemsFromModel, planPage, withSkippedPlan, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// Lead 2fb8d1b0: his most likely next open. Three days ago he wrote a plan for the next day and used that day last; two
// days ago he never acted on, and its draft (recipe 2, as his Nov 20 one) holds the plan lines open; yesterday he never
// acted on either. Yesterday is either a page with no draft (the tab made it) or a page whose draft he saw and left,
// which already took the lines over. Today is drafted. Invented words throughout.
const threeDaysAgo = addDays(today, -3)
const LINES = ['Pack the bags', 'Call the bank'] as const
type Middle = 'page' | 'draft'
type Answer = 'none' | 'one' | 'both' | 'plain' | 'new_todo'
type Tap = ['new' | 'middle' | 'old', 'apply' | 'skip']
const words = (i: { block?: DraftItem['block'] }) => (i.block ? inlineText(i.block.content).trim() : '')

function scene(middle: Middle) {
  const h = harness()
  h.day(threeDaysAgo)
  h.save(dayId(threeDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text(LINES[0])), bullet('b2', text(LINES[1])), bullet('b3', text('Nice view'))], { at: `${threeDaysAgo}T21:00:00.000Z` })
  h.day(twoDaysAgo)
  // Recipe 2 kept no `from`, as his Nov 20 draft: the plan lines as to-dos, and a plain line.
  const block = (id: string, w: string, type = 'task'): DraftItem['block'] => ({ id, type, props: {}, content: [text(w)], children: [] })
  h.run({ type: 'set-draft', pageId: dayId(twoDaysAgo), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: 2, items: [
    { id: 'o1', anchor: '', place: 'after', source: 'model', state: 'open', block: block('ob1', LINES[0]) },
    { id: 'o2', anchor: '', place: 'after', source: 'model', state: 'open', block: block('ob2', LINES[1]) },
    { id: 'o3', anchor: '', place: 'after', source: 'model', state: 'open', block: block('ob3', 'Nice view', 'bulletListItem') },
  ] })
  h.day(yesterday)
  if (middle === 'draft') {
    // Made on that day by the same path, model answering nothing, stored, and never acted on.
    const req = buildDayDraftRequest(h.ws, h.page(dayId(yesterday)), 'UTC')
    let n = 0
    const items = withSkippedPlan(h.ws, h.page(dayId(yesterday)), req, [], () => `m${++n}`).items
    h.run({ type: 'set-draft', pageId: dayId(yesterday), status: 'ready', moreOpen: [], allowedTaskIds: [], items, recipe: DRAFT_RECIPE })
  }
  // What the draft offers (as drawn), and what it stores for an offered item: the line of his it came from.
  const offers = (date: string) => (draftView(h.ws, h.page(dayId(date)))?.items ?? []).map(i => ({ id: i.id, words: words(i), since: i.since, from: draftOf(h.ws, dayId(date))!.items.find(x => x.id === i.id)!.from }))
  const plan = (date: string) => offers(date).filter(i => (LINES as readonly string[]).includes(i.words))
  const tasks = (w: string) => h.ws.tasks.filter(t => t.title === w).length
  // The stored items holding the two lines before today: the old draft's, or the ones yesterday's took them over with.
  const holder = middle === 'page' ? twoDaysAgo : yesterday
  const held = LINES.map(w => draftOf(h.ws, dayId(holder))!.items.find(i => words(i) === w)!.id)
  return { h, offers, plan, tasks, holder, held }
}

/** Today's draft for the scene: the model's answer, then the app's carry. Not stored. */
function draftToday(s: ReturnType<typeof scene>, answer: Answer) {
  s.h.day(today)
  const page = s.h.page(dayId(today))
  const req = buildDayDraftRequest(s.h.ws, page, 'UTC')
  const anchor = [...req.blocks.keys()][0]!
  const lineId = (w: string) => [...req.lines].find(([, n]) => inlineText(n.content).trim() === w)![0]
  const sug = (x: Partial<ModelSuggestion>): ModelSuggestion => ({ anchor, place: 'after', kind: 'line_todo', taskId: '', lineId: '', text: '', why: '', ...x })
  const list: ModelSuggestion[] = answer === 'none' ? []
    : answer === 'one' ? [sug({ lineId: lineId(LINES[1]) })]
    : answer === 'both' ? LINES.map(w => sug({ lineId: lineId(w) }))
    : answer === 'plain' ? [sug({ kind: 'line', lineId: lineId(LINES[0]) })]
    : [sug({ kind: 'new_todo', text: LINES[0] })]
  let n = 0
  const newId = () => `t${++n}`
  return { req, ...withSkippedPlan(s.h.ws, page, req, itemsFromModel(req, list, newId), newId) }
}
const store = (s: ReturnType<typeof scene>, items: DraftItem[]) =>
  s.h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [], items, recipe: DRAFT_RECIPE })

const ANSWERS: Answer[] = ['none', 'one', 'both', 'plain', 'new_todo']
const expectedCarried: Record<Answer, number> = { none: 2, one: 1, both: 0, plain: 1, new_todo: 1 }
// A to-do the model wrote anew in the same words is his line, with its source and age (B106; B105's age label).
const origin = (_answer: Answer, n: 0 | 1) => [`b${n + 1}`, threeDaysAgo]

for (const middle of ['page', 'draft'] as Middle[]) {

  test(`two skipped days, yesterday ${middle === 'page' ? 'a page with no draft' : 'a draft that took the lines over'}: neither counts as used; the plan page is three days ago`, () => {
    const s = scene(middle)
    assert.equal(actedOn(s.h.ws, s.h.page(dayId(twoDaysAgo))), false)
    assert.equal(actedOn(s.h.ws, s.h.page(dayId(yesterday))), false)
    s.h.day(today)
    assert.equal(planPage(s.h.ws, today)?.id, dayId(threeDaysAgo))
    const req = buildDayDraftRequest(s.h.ws, s.h.page(dayId(today)), 'UTC')
    assert.match(req.messages[0]!.content, new RegExp(`"tomorrow" on the \\w+ ${threeDaysAgo} page means ${today}: the user didn't use the days from ${twoDaysAgo} to ${yesterday}`))
    // Where the lines sit open before today's draft: the old draft, or (handed on) yesterday's, with the plan page's age.
    if (middle === 'page') assert.deepEqual(s.plan(twoDaysAgo).map(i => i.words), [...LINES])
    else {
      assert.deepEqual(s.plan(twoDaysAgo), [], 'the old draft handed them on to yesterday\'s')
      assert.deepEqual(s.plan(yesterday).map(i => [i.words, i.from, i.since]), [[LINES[0], 'b1', threeDaysAgo], [LINES[1], 'b2', threeDaysAgo]])
    }
  })

  test(`two skipped days (${middle}): carry — both lines first, once each, as to-dos from his lines, aged the plan day, whatever the model answered`, () => {
    for (const answer of ANSWERS) {
      const s = scene(middle)
      const { items, carried } = draftToday(s, answer)
      const label = `${middle} / ${answer}`
      assert.equal(carried, expectedCarried[answer], label)
      const first = items.slice(0, 2)
      assert.deepEqual(first.map(i => [words(i), i.block?.type, i.from, i.since]), [[LINES[0], 'task', ...origin(answer, 0)], [LINES[1], 'task', ...origin(answer, 1)]], label)
      for (const w of LINES) assert.equal(items.filter(i => words(i) === w).length, 1, `${label}: ${w} once`)
      // Taken over from the draft that holds them now, never also from the one before it.
      assert.deepEqual(first.map(i => i.took), s.held.map(id => [`${dayId(s.holder)} ${id}`]), label)
      // The plain line of the old draft isn't carried this way.
      assert.equal(items.some(i => words(i) === 'Nice view'), false, label)
    }
  })

  test(`two skipped days (${middle}): not twice — once today's draft is stored no earlier draft offers the lines, and each ends as one to-do`, () => {
    for (const answer of ANSWERS) {
      const s = scene(middle)
      store(s, draftToday(s, answer).items)
      const label = `${middle} / ${answer}`
      assert.deepEqual(s.plan(twoDaysAgo), [], label)
      assert.deepEqual(s.plan(yesterday), [], label)
      assert.deepEqual(s.offers(twoDaysAgo).map(i => i.words), ['Nice view'], `${label}: the old draft's plain line stays`)
      for (const id of s.held) assert.throws(() => s.h.run({ type: 'apply-draft', pageId: dayId(s.holder), itemIds: [id], today }), /Nothing to apply/, label)
      const mine = s.plan(today)
      assert.deepEqual(mine.map(i => [i.words, i.from, i.since]), [[LINES[0], ...origin(answer, 0)], [LINES[1], ...origin(answer, 1)]], label)
      s.h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: mine.map(i => i.id), today })
      for (const w of LINES) assert.equal(s.tasks(w), 1, `${label}: ${w}`)
    }
  })

  test(`two skipped days (${middle}): not twice — every tap order across today's and the earlier drafts gives at most one to-do`, () => {
    const sources: Tap[0][] = middle === 'page' ? ['new', 'old'] : ['new', 'middle', 'old']
    const orders: Tap[][] = []
    for (const a of sources) for (const b of sources) if (a !== b) for (const x of ['apply', 'skip'] as const) orders.push([[a, x], [b, 'apply']])
    const dateOf = (w: Tap[0]) => (w === 'new' ? today : w === 'middle' ? yesterday : twoDaysAgo)
    let runs = 0
    // Counted so a change in the known case shows here: the other line offered by two drafts.
    let twiceRuns = 0
    for (const answer of ANSWERS) for (const taps of orders) for (const before of [false, true]) {
      runs++
      const s = scene(middle)
      const log: string[] = []
      const tap = ([which, act]: Tap) => {
        const item = s.plan(dateOf(which)).find(i => i.words === LINES[0])
        if (!item) { log.push(`${which} ${act}: not offered`); return }
        s.h.run(act === 'apply' ? { type: 'apply-draft', pageId: dayId(dateOf(which)), itemIds: [item.id], today } : { type: 'skip-draft', pageId: dayId(dateOf(which)), itemIds: [item.id] })
        log.push(`${which} ${act}`)
      }
      // `before`: the first tap on an earlier draft happens before today's draft is made (he opens that day first).
      const [head, ...rest] = taps
      const early = before && head![0] !== 'new'
      if (early) tap(head!)
      store(s, draftToday(s, answer).items)
      for (const t of early ? rest : taps) tap(t)
      const label = `${middle} / ${answer}${early ? ' / first tap before today\'s draft' : ''}: ${log.join(', ')}`
      const decided = log.filter(l => !l.endsWith('not offered')).length
      const holding = [twoDaysAgo, yesterday, today].filter(d => s.plan(d).some(i => i.words === LINES[0]))
      assert.ok(s.tasks(LINES[0]) <= 1, `${label}: ${s.tasks(LINES[0])} to-dos`)
      // Decided by exactly one draft and offered by none after, or (no tap reached the draft holding it) still offered by one.
      // A to-do the model writes anew in the same words is his line too (B106), so skipped on an earlier draft before
      // today's is made, it isn't offered today either.
      const ok = decided === 1 ? holding.length === 0 : decided === 0 && holding.length === 1
      assert.ok(ok, `${label}: decided ${decided}, offered on ${holding.join(', ') || 'no day'}`)
      // The other line, untouched by these taps, is offered by exactly one draft. After an early tap the earlier day is a
      // used one: its draft keeps its other open line (B103's case) and the model may suggest that line again from the
      // older plan page, so two drafts offer it until one decides it.
      const other = [twoDaysAgo, yesterday, today].filter(d => s.plan(d).some(i => i.words === LINES[1]))
      if (!early) assert.equal(other.length, 1, `${label}: ${LINES[1]} offered on ${other.join(', ') || 'no day'}`)
      else if (other.length !== 1) {
        twiceRuns++
        assert.equal(other.length, 2, `${label}: ${LINES[1]} offered on ${other.join(', ') || 'no day'}`)
        const [here, there] = other as [string, string]
        const stale = s.plan(there).find(i => i.words === LINES[1])!.id
        s.h.run({ type: 'apply-draft', pageId: dayId(here), itemIds: [s.plan(here).find(i => i.words === LINES[1])!.id], today })
        const left = s.plan(there).find(i => i.words === LINES[1])
        assert.equal(left, undefined, `${label}: ${there} still offers ${LINES[1]} after ${here} applied it`)
        // Not only hidden: an Apply on the other draft's item (a stale tab) refuses (Ratchet 094d5ce0).
        assert.throws(() => s.h.run({ type: 'apply-draft', pageId: dayId(there), itemIds: [stale], today }), /Nothing to apply/, label)
        assert.equal(s.tasks(LINES[1]), 1, label)
      }
    }
    assert.equal(runs, ANSWERS.length * orders.length * 2)
    assert.equal(twiceRuns, middle === 'page' ? 4 : 8)
  })
}
