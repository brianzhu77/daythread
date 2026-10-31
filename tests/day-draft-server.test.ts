import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, todo, under } from './v2-helpers.ts'
import { withFallback } from '../src/server/model/day-draft.ts'

// B77 server side: what the app adds without the model, and what "more open" lists (Bumblebee 98e0dcb9, 959b8a91).
test('draft server: planned-for-today is forced in; "more open" is only what the morning covers: yesterday, overdue or due', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Carried from yesterday')))
  h.run({ type: 'create-document', title: 'Backlog', body: '', pageId: 'doc' })
  for (const title of ['Someday idea', 'Due tomorrow', 'Planned for tomorrow']) h.run({ type: 'add-task', pageId: 'doc', title })
  h.run({ type: 'add-task', pageId: 'doc', title: 'Due tomorrow 2' })
  const due = h.task('Due tomorrow'); due.deadlineOn = tomorrow
  h.run({ type: 'plan-task', taskId: h.task('Planned for tomorrow').id, date: tomorrow, today })
  const page = h.day(tomorrow)
  let n = 0
  const { items, moreOpen } = withFallback(h.ws, h.page(dayId(tomorrow)), [], () => `f${++n}`)
  void page
  const title = (id: string) => h.ws.tasks.find(t => t.id === id)!.title
  assert.deepEqual(items.map(i => title(i.taskId!)), [], 'planned for tomorrow is already a row on that page, so not offered again')
  assert.deepEqual(moreOpen.map(title).sort(), ['Carried from yesterday', 'Due tomorrow'])
})

test('draft server: a planned-for-today to-do the model left out comes back as a fallback item', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Call the bank')))
  h.day(tomorrow)
  const t = h.task('Call the bank')
  // Planned for tomorrow without a row there yet (the state a plan from Tasks leaves before the page exists).
  const before = h.ws
  h.run({ type: 'plan-task', taskId: t.id, date: tomorrow, today })
  const page = { ...h.page(dayId(tomorrow)), document: before.pages.find(p => p.id === dayId(tomorrow))!.document }
  let n = 0
  const { items } = withFallback(h.ws, page, [], () => `f${++n}`)
  assert.deepEqual(items.map(i => [i.taskId, i.source, i.place]), [[t.id, 'fallback', 'after']])
})
