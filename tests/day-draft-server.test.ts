import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, todo, under, para, text } from './v2-helpers.ts'
import { buildDayDraftRequest, withFallback } from '../src/server/model/day-draft.ts'

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

test('draft server: a smart note block on the day, or on an earlier day, is not sent, as a database view is not', () => {
  const smart = { id: 's1', type: 'smartNote', props: { noteId: 'n1' }, children: [] }
  const sent = (withNote: boolean) => {
    const h = harness()
    h.day(today)
    h.save(dayId(today), d => [...d, para('y', text('Yesterday words')), ...(withNote ? [{ ...smart, id: 's0' }] : [])])
    h.day(tomorrow)
    h.save(dayId(tomorrow), d => [...d, para('a', text('Before')), ...(withNote ? [smart] : []), para('b', text('After'))])
    return buildDayDraftRequest(h.ws, h.page(dayId(tomorrow)))
  }
  // The earlier page's edit time is the clock's, so two builds a minute apart still compare.
  const anyIds = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').replace(/last edited [^=]*/g, 'last edited ')
  const withNote = sent(true)
  assert.equal(anyIds(JSON.stringify(withNote.messages)), anyIds(JSON.stringify(sent(false).messages)))
  assert.ok([...withNote.blocks.values()].every(n => n.type !== 'smartNote'))
})
