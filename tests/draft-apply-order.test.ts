import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, text, todo, bullet, heading, nodesOf, under } from './v2-helpers.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'
import { draftOf, draftPageId, draftView, type DraftItem } from '../src/domain/day-draft.ts'

// B102 (Jazz 6d7d064e, Lead ee097068): applying a draft's suggestions one at a time ends in the order offered, as
// Apply all does. Four suggestions share one spot, right after the planning heading: a to-do, a new to-do, a line
// and another to-do. Invented words throughout.
const ORDER = ['Book the flights', 'Pack the bags', 'Read the lease', 'Buy a dog bed']

function setup() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  h.day(tomorrow)
  h.save(dayId(tomorrow), () => [heading('m', 'Morning'), bullet('eb', text('Own line')), heading('r', 'Reflection')])
  const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
  const block = (id: string, type: string, words: string): EditorNode => ({ id, type, props: {}, content: [text(words)], children: [] })
  const items: DraftItem[] = [
    { id: 'i0', anchor: 'm', place: 'after', taskId: book, source: 'model', state: 'open' },
    { id: 'i1', anchor: 'm', place: 'after', block: block('b1', 'task', 'Pack the bags'), source: 'model', state: 'open' },
    { id: 'i2', anchor: 'm', place: 'after', block: block('b2', 'bulletListItem', 'Read the lease'), source: 'model', state: 'open' },
    { id: 'i3', anchor: 'm', place: 'after', taskId: dog, source: 'model', state: 'open' },
  ]
  h.run({ type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen: [], allowedTaskIds: [book, dog], items })
  const apply = (...ids: string[]) => h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ids, today })
  const page = () => h.page(dayId(tomorrow))
  /** The page's top-level lines in order, by their words. */
  const lines = () => nodesOf(page()).map(n => inlineText(n.content).trim())
  const rowOf = (id: string) => draftOf(h.ws, dayId(tomorrow))!.items.find(i => i.id === id)!.row!
  return { h, apply, page, lines, rowOf }
}

const expected = ['Morning', ...ORDER, 'Own line', 'Reflection']

test('B102: one at a time from the top gives the same page as Apply all', () => {
  const all = setup()
  all.apply('i0', 'i1', 'i2', 'i3')
  assert.deepEqual(all.lines(), expected)
  const one = setup()
  for (const id of ['i0', 'i1', 'i2', 'i3']) one.apply(id)
  assert.deepEqual(one.lines(), expected)
})

test('B102: in any order, the rows end in the order offered', () => {
  const orders: string[][] = []
  const permute = (left: string[], done: string[] = []) => { if (!left.length) orders.push(done); else for (const x of left) permute(left.filter(y => y !== x), [...done, x]) }
  permute(['i0', 'i1', 'i2', 'i3'])
  for (const order of orders) {
    const s = setup()
    for (const id of order) s.apply(id)
    assert.deepEqual(s.lines(), expected, order.join(' '))
  }
  // Two at once after one alone, too.
  const s = setup()
  s.apply('i2')
  s.apply('i3', 'i0')
  s.apply('i1')
  assert.deepEqual(s.lines(), expected)
})

test('B102: the suggestions still waiting are shown in their offered places around the rows applied', () => {
  const s = setup()
  s.apply('i2')
  const at = (id: string) => draftView(s.h.ws, s.page())!.items.find(i => i.id === id)!.anchorId
  assert.equal(at('i0'), 'm', 'offered before the applied line: still right after the heading')
  assert.equal(at('i1'), 'm')
  assert.equal(at('i3'), s.rowOf('i2'), 'offered after it: below it')
  // Bands sharing a spot keep the offered order.
  assert.deepEqual(draftView(s.h.ws, s.page())!.items.map(i => i.id), ['i0', 'i1', 'i3'])
})

test('B102: a row he deleted or moved away no longer counts; the next lands after the nearest earlier one still there (Jazz)', () => {
  const s = setup()
  s.apply('i0')
  s.apply('i1')
  const pack = s.rowOf('i1')
  s.h.save(dayId(tomorrow), d => d.filter(n => n.id !== pack))
  s.apply('i2')
  assert.deepEqual(s.lines(), ['Morning', 'Book the flights', 'Read the lease', 'Own line', 'Reflection'])
  // Moved away: the first row now sits below his own line, so the next one goes right after the heading.
  const m = setup()
  m.apply('i0')
  const book = m.rowOf('i0')
  m.h.save(dayId(tomorrow), d => { const row = d.find(n => n.id === book)!; const rest = d.filter(n => n.id !== book); return [...rest.slice(0, 2), row, ...rest.slice(2)] })
  assert.deepEqual(m.lines(), ['Morning', 'Own line', 'Book the flights', 'Reflection'])
  m.apply('i1')
  assert.deepEqual(m.lines(), ['Morning', 'Pack the bags', 'Own line', 'Book the flights', 'Reflection'])
})

test('B102: a line he typed right below an applied row stays below the rows that follow it', () => {
  const s = setup()
  s.apply('i0')
  const book = s.rowOf('i0')
  s.h.save(dayId(tomorrow), d => d.flatMap(n => (n.id === book ? [n, bullet('typed', text('Typed by him'))] : [n])))
  s.apply('i1')
  assert.deepEqual(s.lines(), ['Morning', 'Book the flights', 'Pack the bags', 'Typed by him', 'Own line', 'Reflection'])
})

test('B102: rows applied before rows were kept are still found: a to-do by its row, a line by its words', () => {
  const s = setup()
  s.apply('i0')
  s.apply('i2')
  // As a build from before B102 left them: applied, with no row.
  const p = s.h.ws.pages.find(x => x.id === draftPageId(dayId(tomorrow)))!
  const d = JSON.parse(p.document)
  for (const i of d.items) delete i.row
  p.document = JSON.stringify(d)
  s.apply('i3')
  s.apply('i1')
  assert.deepEqual(s.lines(), expected)
})

test('B102: Undo of a single apply puts it back, and applying it again lands in its place', () => {
  const s = setup()
  s.apply('i0')
  s.apply('i2')
  s.h.run({ type: 'undo', targetOperationId: s.h.ws.undo!.operationId })
  assert.deepEqual(s.lines(), ['Morning', 'Book the flights', 'Own line', 'Reflection'])
  s.apply('i3')
  s.apply('i2')
  assert.deepEqual(s.lines(), ['Morning', 'Book the flights', 'Read the lease', 'Buy a dog bed', 'Own line', 'Reflection'])
})

/** Three new to-dos sharing an empty to-do slot (`fill`), or an anchor that is gone (Ratchet 006442d8). */
function shared(mode: 'fill' | 'missing') {
  const h = harness()
  h.day(tomorrow)
  h.save(dayId(tomorrow), () => [heading('m', 'Morning'), { id: 'slot', type: 'task', props: { taskId: 'editor-task:slot' }, content: [], children: [] }, heading('r', 'Reflection')])
  const items: DraftItem[] = ['Alpha', 'Beta', 'Gamma'].map((w, i) => ({ id: `i${i}`, anchor: mode === 'fill' ? 'slot' : 'gone', place: mode === 'fill' ? 'fill' : 'after', source: 'model', state: 'open', block: { id: `b${i}`, type: 'task', props: {}, content: [text(w)], children: [] } }))
  h.run({ type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen: [], allowedTaskIds: [], items })
  const apply = (...ids: string[]) => h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ids, today })
  const words = () => nodesOf(h.page(dayId(tomorrow))).map(n => inlineText(n.content).trim()).filter(w => ['Alpha', 'Beta', 'Gamma'].includes(w))
  const bands = () => draftView(h.ws, h.page(dayId(tomorrow)))!.items.map(i => [i.id, i.anchorId])
  const rowOf = (id: string) => draftOf(h.ws, dayId(tomorrow))!.items.find(i => i.id === id)!.row!
  return { h, apply, words, bands, rowOf }
}

for (const mode of ['fill', 'missing'] as const) {
  test(`B102: suggestions sharing ${mode === 'fill' ? 'an empty slot' : 'a missing anchor'} end in the order offered, in any order, as Apply all`, () => {
    const all = shared(mode)
    all.apply('i0', 'i1', 'i2')
    assert.deepEqual(all.words(), ['Alpha', 'Beta', 'Gamma'])
    for (const order of [['i0', 'i1', 'i2'], ['i0', 'i2', 'i1'], ['i1', 'i0', 'i2'], ['i1', 'i2', 'i0'], ['i2', 'i0', 'i1'], ['i2', 'i1', 'i0']]) {
      const s = shared(mode)
      for (const id of order) s.apply(id)
      assert.deepEqual(s.words(), ['Alpha', 'Beta', 'Gamma'], order.join(' '))
    }
  })

  test(`B102: with ${mode === 'fill' ? 'an empty slot' : 'a missing anchor'}, the bands still waiting sit where their rows will land`, () => {
    const s = shared(mode)
    s.apply('i2')
    const gamma = s.rowOf('i2')
    // Alpha and Beta, offered before Gamma, wait above its row; then Alpha applied, Beta waits between the two.
    const above = nodesOf(s.h.page(dayId(tomorrow)))[nodesOf(s.h.page(dayId(tomorrow))).findIndex(n => n.id === gamma) - 1]!.id
    assert.deepEqual(s.bands(), [['i0', above], ['i1', above]])
    s.apply('i0')
    assert.deepEqual(s.bands(), [['i1', s.rowOf('i0')]])
  })
}
