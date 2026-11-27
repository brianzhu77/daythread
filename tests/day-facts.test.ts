// What the strip above a day's page says (docs/design/native-phase-1.md §12.2). Today is Thu 2026-11-26.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayFacts } from '../src/components/day-facts.ts'
import { pageNodes } from '../src/domain/editor-document.ts'
import { getDayView } from '../src/domain/workspace.ts'
import { bullet, chip, dayId, harness, headingIndex, text, todo, under } from './v2-helpers.ts'

const today = '2026-11-26', yesterday = '2026-11-25', past = '2026-11-20'
const at = '2026-11-26T09:01:00.000Z'

/** The morning of `today with all three parts`, built through the server's own commands. */
function morning() {
  const h = harness()
  h.day(today)
  h.day(yesterday)
  h.save(dayId(today), d => under(d, 'Events', bullet('ev1', text('Standup with Lu '), chip('e-standup', today, '10:30')), bullet('ev2', text('Dentist '), chip('e-dentist', today, '15:00'))), { today, at })
  h.save(dayId(yesterday), d => under(d, 'Events', bullet('ev3', text('Lunch with Kathy '), chip('e-lunch', today))), { today, at })
  h.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' }, 'make-errands')
  const rows = ['File the taxes', 'Send the invoice', 'Start the report', 'Fix the bike', 'Due tomorrow', 'Done', 'Cancelled']
  h.save('errands', d => [...d, ...rows.map((title, i) => todo(`e${i}`, title, 'plan', ''))], { today, at })
  const id = (i: number) => `editor-task:e${i}`
  h.run({ type: 'set-task-dates', taskId: id(0), deadlineOn: today })
  h.run({ type: 'set-task-dates', taskId: id(1), deadlineOn: '2026-11-23' })
  h.run({ type: 'set-task-dates', taskId: id(2), attentionOn: today })
  h.run({ type: 'set-task-dates', taskId: id(3), deadlineOn: today })
  h.run({ type: 'not-today', taskId: id(3), date: today })
  h.run({ type: 'set-task-dates', taskId: id(4), deadlineOn: '2026-11-27' })
  h.run({ type: 'set-task-dates', taskId: id(5), deadlineOn: today })
  h.run({ type: 'task-status', taskId: id(5), status: 'done', today })
  h.run({ type: 'set-task-dates', taskId: id(6), deadlineOn: today })
  h.run({ type: 'task-status', taskId: id(6), status: 'cancelled', today })
  h.day(past)
  h.run({ type: 'add-task', pageId: dayId(past), title: 'Sort the shed', plannedOn: past, attentionOn: past })
  h.run({ type: 'not-today', taskId: h.task('Sort the shed').id, date: today })
  h.save('errands', d => [...d, todo('fence', 'Mend the fence', 'plan', '')], { today, at })
  h.run({ type: 'not-today', taskId: 'editor-task:fence', date: today })
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Pay the rent', plannedOn: today, deadlineOn: today })
  h.run({ type: 'add-task', pageId: dayId(yesterday), title: '　 ', plannedOn: yesterday, deadlineOn: today })
  return h
}
const facts = (h: ReturnType<typeof harness>, date: string) => dayFacts(getDayView(h.ws, date), h.ws, date, today)
const words = (rows: { words: string; tag: string }[]) => rows.map(r => [r.words, r.tag])

test('today with all three parts', () => {
  const h = morning()
  const doc = pageNodes(h.page(dayId(today)))
  const f = facts(h, today)!
  assert.deepEqual(f.events, { text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+1 more', headingId: doc[headingIndex(doc, 'Events')]!.id })
  assert.deepEqual(words(f.dueSoon), [
    ['File the taxes', 'Due today'], ['Send the invoice', 'Was due Mon'], ['Start the report', 'Start today'],
    ['Fix the bike', 'Not today · Due today'], ['Sort the shed', 'Not today'],
  ])
  assert.deepEqual(f.dueSoon.map(r => r.setAside), [false, false, false, true, true])
  assert.equal(f.notToday!.title, 'Not today · 3')
  assert.deepEqual(words(f.notToday!.rows), [['Fix the bike', 'Due today'], ['Sort the shed', ''], ['Mend the fence', 'Unscheduled']])
  assert.ok(f.notToday!.rows.every(r => r.setAside))
})

test('a to-do set aside whose tag is empty reads Not today, with no dot', () => {
  const row = facts(morning(), today)!.dueSoon.find(r => r.words === 'Sort the shed')!
  assert.equal(row.tag, 'Not today')
})

test('a past day has no Not today part, though some are set aside', () => {
  const f = facts(morning(), past)!
  assert.equal(f.notToday, null)
  assert.equal(f.events, null)
})

test('a later day without a page has no strip', () => {
  assert.equal(facts(morning(), '2026-12-04'), null)
})
