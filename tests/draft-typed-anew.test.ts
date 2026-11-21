import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, twoDaysAgo, tomorrow, text, bullet, heading, todo } from './v2-helpers.ts'
import { inlineText } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, draftOf, draftStale, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { addDays } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, itemsFromModel, withSkippedPlan, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// B106 (Lead 1fc8ac64): a plan line he applied or crossed out in one day's draft came back in a later day's draft when
// the model typed it anew, word for word (2 of 20 opens of his Nov 22). Typed words that read as a line the model was
// sent are now that line, so the "decided on another day" rule holds; words he writes again after deciding are offered.
// Invented words throughout.
const threeDaysAgo = addDays(today, -3)
const LINES = ['Pack the bags', 'Call the bank'] as const
const at = (date: string, hm: string) => `${date}T${hm}:00.000Z`
const words = (i: { block?: DraftItem['block'] }) => (i.block ? inlineText(i.block.content).trim() : '')
type H = ReturnType<typeof harness>
type Sug = Partial<ModelSuggestion>
type Kind = 'line_todo' | 'line' | 'new_todo' | 'new_line'
const KINDS: Kind[] = ['line_todo', 'line', 'new_todo', 'new_line']

/** A draft for `date` made by the server's path (the model's answer, then the app's carry), stored by `recipe`. */
function make(h: H, date: string, answer: (lineId: (w: string) => string, idOf: (nodeId: string) => string) => Sug[], recipe = DRAFT_RECIPE) {
  if (!h.ws.pages.some(p => p.id === dayId(date))) h.day(date)
  const page = h.page(dayId(date)), req = buildDayDraftRequest(h.ws, page, 'UTC')
  const anchor = [...req.blocks.keys()][0]!
  const lineId = (w: string) => [...req.lines].find(([, n]) => inlineText(n.content).trim() === w)?.[0] ?? 'L-none'
  const idOf = (nodeId: string) => [...req.lines].find(([, n]) => n.id === nodeId)?.[0] ?? 'L-none'
  let n = 0
  const newId = () => `${date}-${recipe}-${++n}`
  const sugs = answer(lineId, idOf).map(x => ({ anchor, place: 'after', kind: 'line_todo', taskId: '', lineId: '', text: '', why: '', ...x }) as ModelSuggestion)
  const drops: Record<string, number> = {}
  const items = withSkippedPlan(h.ws, page, req, itemsFromModel(req, sugs, newId, drops), newId).items
  h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [...req.tasks.values()].map(t => t.id), items, recipe })
  return { req, drops }
}
/** What the draft for `date` offers, as drawn: the words, his to-do's id when it is one, and the stored item's source. */
const offered = (h: H, date: string) => (draftView(h.ws, h.page(dayId(date)))?.items ?? [])
  .map(i => ({ id: i.id, words: words(i), taskId: i.taskId, since: i.since, from: draftOf(h.ws, dayId(date))!.items.find(x => x.id === i.id)!.from }))
const offering = (h: H, date: string, w: string) => offered(h, date).filter(i => i.words === w)
const todos = (h: H, w: string) => h.ws.tasks.filter(t => t.title === w)
/** The model's answer for `w` by kind: carried by the line's id (the most recently edited one sent), or typed anew. */
const as = (kind: Kind, w: string, lineId: (w: string) => string): Sug => (kind === 'line_todo' || kind === 'line' ? { kind, lineId: lineId(w) } : { kind, text: w })

/**
 * His Nov 22 shape (Lead's scratch): three days ago he wrote two plan lines; two days ago a recipe 2 draft holds them,
 * unused; yesterday's draft carried both by their ids, and he applied the first (ticked done or left open) and crossed out
 * the second.
 */
function scene(tick: boolean) {
  const h = harness()
  h.day(threeDaysAgo)
  h.save(dayId(threeDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text(LINES[0])), bullet('b2', text(LINES[1]))], { at: at(threeDaysAgo, '21:00') })
  h.day(twoDaysAgo)
  const block = (id: string, w: string): DraftItem['block'] => ({ id, type: 'task', props: {}, content: [text(w)], children: [] })
  h.run({ type: 'set-draft', pageId: dayId(twoDaysAgo), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: 2, items: [
    { id: 'o1', anchor: '', place: 'after', source: 'model', state: 'open', block: block('ob1', LINES[0]) },
    { id: 'o2', anchor: '', place: 'after', source: 'model', state: 'open', block: block('ob2', LINES[1]) },
  ] })
  make(h, yesterday, lineId => LINES.map(w => ({ lineId: lineId(w) })))
  const y = draftOf(h.ws, dayId(yesterday))!.items
  assert.deepEqual(LINES.map(w => y.find(i => words(i) === w)?.from), ['b1', 'b2'], 'yesterday carried both by their ids')
  h.run({ type: 'apply-draft', pageId: dayId(yesterday), itemIds: [y.find(i => words(i) === LINES[0])!.id], today: yesterday })
  h.run({ type: 'skip-draft', pageId: dayId(yesterday), itemIds: [y.find(i => words(i) === LINES[1])!.id] })
  if (tick) h.run({ type: 'task-status', taskId: h.task(LINES[0]).id, status: 'done', today: yesterday })
  return h
}

test('B106: a line he decided yesterday is never offered again today, carried by its id or typed anew, as a to-do or a line', () => {
  for (const tick of [true, false]) for (const kind of KINDS) {
    const h = scene(tick), label = `${tick ? 'applied and ticked' : 'applied, left open'} / ${kind}`
    make(h, today, lineId => LINES.map(w => as(kind, w, lineId)))
    assert.deepEqual(offering(h, today, LINES[1]), [], `${label}: the crossed-out line`)
    const applied = offering(h, today, LINES[0])
    // Left open, his to-do is still an open to-do and may be offered as itself; never a copy of its words.
    if (tick) assert.deepEqual(applied, [], `${label}: the applied line`)
    else assert.ok(applied.every(i => i.taskId === h.task(LINES[0]).id) && applied.length <= 1, `${label}: ${JSON.stringify(applied)}`)
    const ids = offered(h, today).map(i => i.id)
    if (ids.length) h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ids, today })
    assert.equal(todos(h, LINES[0]).length, 1, `${label}: one to-do for the applied line after Apply all`)
    assert.equal(todos(h, LINES[1]).length, 0, `${label}: no to-do for the crossed-out line after Apply all`)
  }
})

test('B106: "the same words" is sameWords: case, spacing and a trailing stop; a paraphrase is a new suggestion', () => {
  for (const kind of ['new_todo', 'new_line'] as const) {
    const h = scene(true)
    make(h, today, () => [{ kind, text: '  call THE   bank. ' }, { kind, text: 'PACK the bags!' }, { kind, text: 'Phone the bank' }])
    assert.deepEqual(offered(h, today).map(i => [i.words, i.from]), [['Phone the bank', undefined]], kind)
  }
})

test('B106: words he writes again after deciding are his new line, offered from it, wherever he wrote them', () => {
  const places = {
    'yesterday\'s page': (h: H, w: string) => h.save(dayId(yesterday), d => [...d, bullet('again', text(w))], { at: at(yesterday, '20:00') }),
    'another page': (h: H, w: string) => {
      h.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' })
      h.save('errands', () => [bullet('again', text(w))], { at: at(yesterday, '20:00') })
    },
  }
  for (const [where, write] of Object.entries(places)) for (const w of LINES) for (const kind of ['new_todo', 'new_line'] as const) {
    const h = scene(true), label = `${w} / ${where} / ${kind}`
    write(h, w)
    make(h, today, () => [{ kind, text: w }])
    assert.deepEqual(offering(h, today, w).map(i => i.from), ['again'], label)
    // Carried by its id it's offered the same; only the old, decided line is held back.
    const h2 = scene(true)
    write(h2, w)
    make(h2, today, (_, idOf) => [{ kind: 'line_todo', lineId: idOf('again') }])
    assert.deepEqual(offering(h2, today, w).map(i => i.from), ['again'], `${label}, carried`)
  }
  // Written again as a to-do row: an open to-do, offered as itself whichever way the model names it.
  for (const kind of KINDS) {
    const h = scene(true), w = LINES[1]
    h.save(dayId(yesterday), d => [...d, todo('again', w, 'plan', yesterday)], { at: at(yesterday, '20:00') })
    make(h, today, lineId => [as(kind, w, lineId)])
    assert.deepEqual(offering(h, today, w).map(i => i.taskId), [h.task(w).id], `to-do row / ${kind}`)
  }
})

test('B106: among sent lines with the same words, the first he hasn\'t decided wins, even when the decided one\'s page was edited last', () => {
  const h = scene(true)
  h.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' })
  h.save('errands', () => [bullet('again', text(LINES[1]))], { at: at(yesterday, '10:00') })
  // The plan page, with the decided line on it, is edited after: it's sent first.
  h.save(dayId(threeDaysAgo), d => [...d, bullet('b9', text('Buy stamps'))], { at: at(yesterday, '22:00') })
  const { req } = make(h, today, () => [{ kind: 'new_todo', text: LINES[1] }])
  const order = [...req.lines].filter(([, n]) => words({ block: n }) === LINES[1]).map(([id, n]) => [id, n.id, req.settled.has(id)])
  assert.deepEqual(order.map(([, node, settled]) => [node, settled]), [['b2', true], ['again', false]])
  assert.deepEqual(offering(h, today, LINES[1]).map(i => i.from), ['again'])

  // Two lines with the same words he hasn't decided: the one on the page edited last.
  const h2 = harness()
  h2.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' })
  h2.save('errands', () => [bullet('e1', text('Book the dentist'))], { at: at(yesterday, '10:00') })
  h2.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'trip' })
  h2.save('trip', () => [bullet('t1', text('Book the dentist'))], { at: at(yesterday, '12:00') })
  make(h2, today, () => [{ kind: 'new_todo', text: 'Book the dentist' }])
  assert.deepEqual(offering(h2, today, 'Book the dentist').map(i => i.from), ['t1'])
})

test('B106: words that read as a to-do row are that to-do: one done is not offered, one open is offered as itself (Ratchet 604ff4e5)', () => {
  for (const status of ['done', 'open'] as const) for (const kind of ['new_todo', 'new_line'] as const) {
    const h = harness(), label = `${status} / ${kind}`
    h.day(yesterday)
    h.save(dayId(yesterday), d => [...d, todo('own', 'Renew the passport', 'plan', yesterday)], { at: at(yesterday, '09:00') })
    const t = h.task('Renew the passport')
    if (status === 'done') h.run({ type: 'task-status', taskId: t.id, status: 'done', today: yesterday })
    const { drops } = make(h, today, () => [{ kind, text: 'Renew the passport' }])
    if (status === 'done') {
      assert.deepEqual(offering(h, today, 'Renew the passport'), [], label)
      assert.equal(draftOf(h.ws, dayId(today))!.items.some(i => words(i) === 'Renew the passport'), false, `${label}: not stored`)
      assert.equal(drops['not-an-open-todo'], 1, label)
    } else assert.deepEqual(offering(h, today, 'Renew the passport').map(i => i.taskId), [t.id], label)
    assert.equal(todos(h, 'Renew the passport').length, 1, label)
  }
})

test('B106: a line he crossed out in a recipe 2 draft (no source, his Nov 20 shape) is known by its words; written again later, it is offered', () => {
  const setUp = () => {
    const h = harness()
    h.day(threeDaysAgo)
    h.save(dayId(threeDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b2', text(LINES[1]))], { at: at(threeDaysAgo, '21:00') })
    h.day(twoDaysAgo)
    h.run({ type: 'set-draft', pageId: dayId(twoDaysAgo), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: 2, items: [
      { id: 'o2', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: 'ob2', type: 'task', props: {}, content: [text(LINES[1])], children: [] } },
    ] })
    h.run({ type: 'skip-draft', pageId: dayId(twoDaysAgo), itemIds: ['o2'] })
    return h
  }
  for (const kind of KINDS) {
    const h = setUp()
    make(h, today, lineId => [as(kind, LINES[1], lineId)])
    assert.deepEqual(offering(h, today, LINES[1]), [], kind)
  }
  const h = setUp()
  h.day(yesterday)
  h.save(dayId(yesterday), d => [...d, bullet('again', text(LINES[1]))], { at: at(yesterday, '20:00') })
  make(h, today, () => [{ kind: 'new_todo', text: LINES[1] }])
  assert.deepEqual(offering(h, today, LINES[1]).map(i => i.from), ['again'])
})

/** Today's draft as an older build stored it (recipe 4): the crossed-out line typed anew with no source, and two more. */
function recipe4Today(h: H) {
  h.day(today)
  const block = (id: string, w: string, type = 'task'): DraftItem['block'] => ({ id, type, props: {}, content: [text(w)], children: [] })
  h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: 4, items: [
    { id: 'r1', anchor: '', place: 'after', source: 'model', state: 'open', block: block('rb1', LINES[1]) },
    { id: 'r2', anchor: '', place: 'after', source: 'model', state: 'open', block: block('rb2', 'Water the plants', 'paragraph') },
    { id: 'r3', anchor: '', place: 'after', source: 'model', state: 'open', block: block('rb3', 'Buy milk') },
  ] })
  h.run({ type: 'apply-draft', pageId: dayId(today), itemIds: ['r2'], today })
  h.run({ type: 'skip-draft', pageId: dayId(today), itemIds: ['r3'] })
}
const decidedIn = (h: H, date: string) => draftOf(h.ws, dayId(date))!.items.filter(i => i.state !== 'open').map(i => [i.id, i.state, words(i)])

test('B106 remake (Lead a8cd2d57): today\'s recipe 4 draft with the returned line still open is made again once; it\'s gone, his decisions stay', () => {
  const h = scene(true)
  recipe4Today(h)
  assert.deepEqual(offering(h, today, LINES[1]).map(i => i.id), ['r1'], 'the older build offers it')
  assert.equal(draftStale(draftOf(h.ws, dayId(today))!), true)
  const before = decidedIn(h, today)
  // The model types it anew again on the remake.
  make(h, today, () => [{ kind: 'new_todo', text: LINES[1] }, { kind: 'new_todo', text: 'Buy milk' }])
  assert.deepEqual(offering(h, today, LINES[1]), [])
  assert.deepEqual(offering(h, today, 'Buy milk'), [], 'crossed out in the old draft, not offered again')
  assert.deepEqual(decidedIn(h, today), before)
  assert.equal(draftStale(draftOf(h.ws, dayId(today))!), false, 'made again once')
})

test('B106 remake (Lead a8cd2d57): the returned line he already crossed out today stays crossed out, and tomorrow doesn\'t offer it', () => {
  for (const kind of KINDS) {
    const h = scene(true)
    recipe4Today(h)
    h.run({ type: 'skip-draft', pageId: dayId(today), itemIds: ['r1'] })
    const before = decidedIn(h, today)
    make(h, today, () => [{ kind: 'new_todo', text: LINES[1] }])
    assert.deepEqual(decidedIn(h, today), before)
    assert.deepEqual(offering(h, today, LINES[1]), [])
    make(h, tomorrow, lineId => [as(kind, LINES[1], lineId)])
    assert.deepEqual(offering(h, tomorrow, LINES[1]), [], `tomorrow / ${kind}`)
  }
})

test('B106: an item an older recipe (3-4) typed anew and he crossed out has no source; it is known by its words, against lines written before its day', () => {
  const setUp = () => {
    const h = harness()
    h.day(yesterday)
    h.save(dayId(yesterday), d => [...d, heading('h', 'Next day'), bullet('p1', text('Ring the plumber'))], { at: at(yesterday, '21:00') })
    h.day(today)
    h.run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: [], recipe: 4, items: [
      { id: 'r1', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: 'rb1', type: 'task', props: {}, content: [text('Ring the plumber')], children: [] } },
    ] })
    h.run({ type: 'skip-draft', pageId: dayId(today), itemIds: ['r1'] })
    return h
  }
  for (const kind of KINDS) {
    const h = setUp()
    make(h, tomorrow, lineId => [as(kind, 'Ring the plumber', lineId)])
    assert.deepEqual(offering(h, tomorrow, 'Ring the plumber'), [], kind)
  }
  // Written again on the day he crossed it out: a line that couldn't have been in that draft, so it's offered.
  const h = setUp()
  h.save(dayId(today), d => [...d, bullet('again', text('Ring the plumber'))], { at: at(today, '20:00') })
  make(h, tomorrow, () => [{ kind: 'new_todo', text: 'Ring the plumber' }])
  assert.deepEqual(offering(h, tomorrow, 'Ring the plumber').map(i => i.from), ['again'])
})
