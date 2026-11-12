import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, yesterday, tomorrow, text, todo, bullet, para, heading, chip, nodesOf, under } from './v2-helpers.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'
import { DRAFT_RECIPE, draftOf, draftStale, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { addDays } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, itemsFromModel, type DayDraftRequest, type ModelSuggestion } from '../src/server/model/day-draft.ts'

// Brian 3d7aca46: a day draft reads every page edited in the last 7 days, and what he wrote for the day comes first.
// Invented words throughout. `today` is the day being drafted.
const nested = (id: string, words: string, children: EditorNode[]): EditorNode => ({ ...bullet(id, text(words)), children })
const at = (date: string, time = '21:00') => `${date}T${time}:00.000Z`
const sentText = (req: DayDraftRequest) => req.messages[1]!.content
const lineId = (req: DayDraftRequest, words: string) => [...req.lines].find(([, n]) => inlineText(n.content).trim() === words)?.[0]
const anchorOf = (req: DayDraftRequest) => [...req.blocks.keys()][0]!
const suggest = (req: DayDraftRequest, list: Partial<ModelSuggestion>[]): ModelSuggestion[] =>
  list.map(s => ({ anchor: anchorOf(req), place: 'after', kind: 'line', taskId: '', lineId: '', text: '', why: '', ...s }))

/** Yesterday's page with a plan for today at its end (one line with three nested under it), and today's page. */
function week() {
  const h = harness()
  h.day(yesterday)
  h.save(dayId(yesterday), d => [...under(d, 'TODO', todo('y1', 'Water the plants')), heading('next', 'Next up'),
    nested('plan', 'Garage', [bullet('p1', text('Sort the screws')), bullet('p2', text('Sweep the floor')), bullet('p3', text('Oil the hinge'))])], { at: at(yesterday) })
  h.day(today)
  return h
}

test('day draft: the last day page is sent whole, nested lines indented under the line they belong to, each with an id', () => {
  const h = week()
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC')
  const sent = sentText(req)
  assert.match(sent, /== Day page Wednesday 2026-10-21, last edited 2026-10-21 21:00 ==/)
  const order = ['Next up', 'Garage', 'Sort the screws', 'Sweep the floor', 'Oil the hinge'].map(w => sent.indexOf(w))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the order written')
  assert.match(sent, /L\d+ {3}- Sort the screws/, 'one level in')
  for (const w of ['Garage', 'Sort the screws', 'Sweep the floor', 'Oil the hinge']) assert.ok(lineId(req, w), `${w} can be carried`)
  // The prompt says what goes first, and how to read "tomorrow" on a page from another day, without naming his headings.
  const system = req.messages[0]!.content
  assert.match(system, /What the user already wrote down to do on 2026-10-22/)
  assert.match(system, /"tomorrow" on the Wednesday 2026-10-21 page means 2026-10-22/)
  assert.doesNotMatch(system, /Next up|TODO/)
})

test('day draft: every page edited in the last 7 days is read, newest first; older ones are not, but the last day page always is', () => {
  const h = week()
  for (const [id, title, edited] of [['trip', 'Trip notes', at(addDays(today, -3), '08:00')], ['old', 'Old notes', at(addDays(today, -9))], ['fresh', 'Shop list', at(today, '06:00')]] as const) {
    h.run({ type: 'create-document', title, body: '', pageId: id })
    h.save(id, d => [...d, para(`${id}-l`, text(`${title} line`))], { at: edited })
  }
  // A day page from before pages kept their edit time counts by its date; one from before the window doesn't.
  for (const date of [addDays(today, -5), addDays(today, -12)]) { h.day(date); h.save(dayId(date), d => [...d, para(`d-${date}`, text(`Written on ${date}`))]); delete h.page(dayId(date)).editedAt }
  const sent = sentText(buildDayDraftRequest(h.ws, h.page(dayId(today)), 'UTC'))
  const where = (w: string) => sent.indexOf(w)
  assert.ok(where('Shop list line') >= 0 && where('Trip notes line') >= 0 && where(`Written on ${addDays(today, -5)}`) >= 0)
  assert.equal(where('Old notes line'), -1, 'edited 9 days before')
  assert.equal(where(`Written on ${addDays(today, -12)}`), -1, '12 days before, and not the last day page')
  assert.ok(where('Shop list line') < where('Sort the screws') && where('Sort the screws') < where('Trip notes line') && where('Trip notes line') < where(`Written on ${addDays(today, -5)}`), 'most recently edited first')
  // With nothing in the window, the last day page is still read, however old.
  const g = harness()
  g.day(addDays(today, -20)); g.save(dayId(addDays(today, -20)), d => [...d, para('far', text('From long ago'))], { at: at(addDays(today, -20)) })
  g.day(today)
  assert.match(sentText(buildDayDraftRequest(g.ws, g.page(dayId(today)))), /From long ago/)
})

test('day draft: a long page keeps its end, where a plan for the next day sits; template words already on today\'s page aren\'t sent again', () => {
  const h = week()
  h.save(dayId(yesterday), d => [...d, ...Array.from({ length: 400 }, (_, i) => para(`n${i}`, text(`Note number ${i} about the day, written at some length`))), heading('t', 'Later'), bullet('last', text('Call the plumber'))], { at: at(yesterday, '22:00') })
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)))
  const sent = sentText(req)
  assert.ok(lineId(req, 'Call the plumber'), 'the last line is kept')
  assert.match(sent, /Note number 0 about/, 'and the first')
  assert.match(sent, /\(… \d+ lines left out …\)/)
  assert.doesNotMatch(sent, /Note number 200 about/)
  assert.ok(sent.length < 45_000)
})

test('day draft: a carried line becomes a to-do in his words; one that is an open to-do, or already on the page, is not copied', () => {
  const h = week()
  h.save(dayId(today), d => under(d, 'TODO', todo('t1', 'Oil the hinge')))
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)))
  let n = 0
  const items = itemsFromModel(req, suggest(req, [
    { kind: 'line_todo', lineId: lineId(req, 'Garage')! },
    { kind: 'line_todo', lineId: lineId(req, 'Sort the screws')! },
    { kind: 'line_todo', lineId: lineId(req, 'Sort the screws')! },
    { kind: 'new_todo', text: 'sort the screws.' },
    { kind: 'line_todo', lineId: lineId(req, 'Oil the hinge') ?? 'L999' },
    { kind: 'line_todo', lineId: lineId(req, 'Water the plants')! },
    { kind: 'new_todo', text: 'water the plants' },
    { kind: 'line', lineId: lineId(req, 'Sweep the floor')! },
  ]), () => `x${++n}`)
  const plants = h.task('Water the plants').id
  assert.deepEqual(items.map(i => i.taskId ? `task:${i.taskId === plants ? 'plants' : i.taskId}` : `${i.block!.type}:${inlineText(i.block!.content)}`),
    ['task:Garage', 'task:Sort the screws', 'task:plants', 'bulletListItem:Sweep the floor'])
  assert.equal(lineId(req, 'Oil the hinge'), undefined, 'a line already on today\'s page isn\'t sent')
})

test('day draft: a dated line is never carried; the events show it', () => {
  const h = harness()
  h.day(yesterday)
  h.save(dayId(yesterday), d => [...d, para('c', text('Dentist '), chip('e1', today, '09:00'))], { at: at(yesterday) })
  h.day(today)
  const req = buildDayDraftRequest(h.ws, h.page(dayId(today)))
  const id = [...req.lines].find(([, n]) => n.id === 'c')?.[0]
  assert.ok(id)
  assert.deepEqual(itemsFromModel(req, suggest(req, [{ kind: 'line_todo', lineId: id }]), () => 'x'), [])
})

test('save: a day page records when its content was last edited, like any page; a save with nothing new doesn\'t move it', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => [...d, para('a', text('Something'))], { at: at(today, '07:00') })
  assert.equal(h.page(dayId(today)).editedAt, at(today, '07:00'))
  h.save(dayId(today), d => d, { at: at(today, '08:00') })
  assert.equal(h.page(dayId(today)).editedAt, at(today, '07:00'))
  h.run({ type: 'create-document', title: 'Plain', body: '', pageId: 'doc' })
  h.save('doc', d => [...d, para('b', text('Words'))], { at: at(today, '09:00') })
  assert.equal(h.page('doc').editedAt, at(today, '09:00'))
})

/** A ready draft for tomorrow from before recipes were kept: one to-do applied, one skipped, one line still open. */
function remade() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  h.day(tomorrow)
  const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
  const line = (id: string, words: string): DraftItem => ({ id, anchor: '', place: 'after', source: 'model', state: 'open', block: { id: `${id}-b`, type: 'bulletListItem', props: {}, content: [text(words)], children: [] } })
  h.run({ type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen: [], allowedTaskIds: [book, dog], items: [
    { id: 'a', anchor: '', place: 'after', taskId: book, source: 'model', state: 'open' },
    { id: 'b', anchor: '', place: 'after', taskId: dog, source: 'model', state: 'open' },
    line('c', 'Pack the charger'),
  ] })
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['a'], today })
  h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['b'] })
  const set = (items: DraftItem[], status: 'ready' | 'failed' = 'ready', recipe: number | null = DRAFT_RECIPE, moreOpen: string[] = []) =>
    h.run({ type: 'set-draft', pageId: dayId(tomorrow), status, moreOpen, allowedTaskIds: [book, dog], items, ...(recipe ? { recipe } : {}) })
  return { h, book, dog, line, set, draft: () => draftOf(h.ws, dayId(tomorrow))! }
}

test('day draft: one an older recipe made is made again once, keeping what he applied or skipped', () => {
  const { h, book, dog, line, set, draft } = remade()
  assert.equal(draftStale(draft()), true)
  set([{ id: 'n1', anchor: '', place: 'after', taskId: dog, source: 'model', state: 'open' }, line('n2', 'Sort the screws'), line('n3', 'Pack the charger')], 'ready', DRAFT_RECIPE, [dog])
  const d = draft()
  assert.equal(d.recipe, DRAFT_RECIPE)
  assert.equal(draftStale(d), false)
  assert.deepEqual(d.items.map(i => [i.id, i.state]), [['a', 'applied'], ['b', 'skipped'], ['n2', 'open'], ['n3', 'open']], 'the skipped to-do isn\'t offered again; the open line is offered anew')
  // Its task id too: B92 tells a carried day from a chosen one by the applied items of that day's draft (Roadbuster 0983f2da).
  assert.deepEqual(d.items.filter(i => i.state !== 'open').map(i => i.taskId), [book, dog])
  assert.equal(nodesOf(h.page(dayId(tomorrow))).filter(n => n.type === 'task' && n.props?.taskId === book).length, 1, 'what he applied stays on the page')
  // Nor under "more open", where the new run lists it as an open to-do it didn't place (Ratchet ea6ab2bd).
  assert.deepEqual(d.moreOpen, [])
  assert.deepEqual(draftView(h.ws, h.page(dayId(tomorrow)))!.moreOpen, [])
  // Made by this recipe, it's the day's draft for good.
  assert.throws(() => set([line('n4', 'Again')]), /already has its draft/)
})

test('day draft: a remake that failed, or one from an older build, leaves a settled draft as it is', () => {
  const { set, line, draft } = remade()
  const before = JSON.stringify(draft())
  assert.throws(() => set([line('n1', 'Fallback only')], 'failed'), /already has its draft/)
  assert.throws(() => set([line('n1', 'From an older tab')], 'ready', null), /already has its draft/)
  assert.equal(JSON.stringify(draft()), before)
})
