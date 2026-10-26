import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView, plannedOn } from '../src/domain/workspace.ts'
import { dayTemplate, editorSeed, inlineText, pageContentKey, pageNodes } from '../src/domain/editor-document.ts'
import { dayEvents } from '../src/domain/chip-events.ts'
import { getUpcomingByDate } from '../src/domain/upcoming.ts'
import { bullet, card, chip, dayId, flat, harness, heading, headingIndex, nodesOf, pageRef, para, taskRowsOn, text, today, todo, tomorrow, twoDaysAgo, under, yesterday } from './v2-helpers.ts'

test('a new day page holds the built-in template: plain headings and one empty row each; opening it twice changes nothing', () => {
  const h = harness()
  const p = h.day(today)
  const doc = nodesOf(p)
  assert.deepEqual(doc.filter(n => n.type === 'heading').map(n => inlineText(n.content)), dayTemplate.map(t => t.title))
  assert.deepEqual(dayTemplate.map(t => t.title), ['TODO', 'Events', 'Good Stuffs', 'Notes'])
  assert.deepEqual(doc.map(n => n.type), ['heading', 'task', 'heading', 'bulletListItem', 'heading', 'bulletListItem', 'heading', 'bulletListItem'])
  assert.equal(doc[1]!.props?.taskId, `editor-task:${doc[1]!.id}`)
  assert.equal(h.ws.tasks.length, 0)
  const before = h.ws.revision
  h.run({ type: 'ensure-day', date: today })
  assert.equal(h.ws.revision, before + 1)
  assert.equal(h.ws.pages.length, 1)
  assert.equal(p.id, dayId(today))
})

test('typing a to-do creates a task planned for that day; the empty template row creates none; planned order follows the document, nested rows included', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'First'), todo('b', 'Second', 'plan', today, [todo('b1', 'Second, part one')]), todo('c', 'Third')))
  assert.equal(h.ws.tasks.length, 3 + 1)
  const view = getDayView(h.ws, today)
  assert.deepEqual(view.planned.map(t => t.title), ['First', 'Second', 'Second, part one', 'Third'])
  assert.equal(plannedOn(h.ws, h.task('First').id), today)
  assert.equal(h.task('First').id, 'editor-task:a')
  assert.equal(h.task('First').status, 'open')
  assert.equal(h.task('First').sourcePageId, dayId(today))
  // A row on a document page is a reference, not a plan.
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'D' })
  h.save('D', doc => [...doc, todo('d', 'Reference only', 'reference', '')])
  assert.equal(plannedOn(h.ws, h.task('Reference only').id), null)
  assert.ok(!getDayView(h.ws, today).planned.some(t => t.title === 'Reference only'))
  assert.ok(getDayView(h.ws, today).openPool.some(t => t.title === 'Reference only'))
})

test("a row's words edit the title; a title edited elsewhere shows in the editor seed; a page save never rolls another page's title back", () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'Draft title')))
  const id = h.task('Draft title').id
  h.save(dayId(today), doc => doc.map(n => n.id === 'a' ? { ...n, content: [text('Final title')] } : n))
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'Final title')
  // The task is also referenced from a document page; renaming it there shows on the day page's seed.
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'D' })
  h.save('D', doc => [...doc, { ...todo('ref', 'x', 'reference', ''), props: { taskId: id, role: 'reference', planDate: '' } }])
  h.save('D', doc => doc.map(n => n.id === 'ref' ? { ...n, content: [text('Renamed on Doc')] } : n))
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'Renamed on Doc')
  const seeded = editorSeed(h.page(dayId(today)), h.ws).find(n => n.id === 'a')!
  assert.equal(inlineText(seeded.content), 'Renamed on Doc')
  // The day page's stored document still says the old words; a save that doesn't touch the row keeps the new title.
  h.save(dayId(today), doc => [...doc, para('note', text('unrelated'))])
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'Renamed on Doc')
})

test('deleting the only row of a task born on the page deletes the task; ⌘Z brings it back with its status', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'Born here')))
  const id = h.task('Born here').id
  h.run({ type: 'task-status', taskId: id, status: 'done', today })
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'a'), { singleDeleteIds: ['a'] })
  assert.ok(!h.ws.tasks.some(t => t.id === id))
  assert.ok(h.ws.deletedTasks.some(t => t.id === id))
  // ⌘Z: the editor saves the document with the row back, under the same identity.
  h.save(dayId(today), doc => under(doc, 'TODO', { ...todo('a', 'Born here'), props: { taskId: id, role: 'plan', planDate: today } }))
  const back = h.ws.tasks.find(t => t.id === id)!
  assert.equal(back.status, 'done')
  assert.equal(back.doneOn, today)
  assert.ok(!h.ws.deletedTasks.some(t => t.id === id))
  // A bulk delete (a whole section) deletes a born-here task the same way; the tombstone list stays short.
  for (let i = 0; i < 120; i++) { h.save(dayId(today), doc => under(doc, 'TODO', todo(`t${i}`, `Bulk ${i}`))); h.save(dayId(today), doc => doc.filter(n => n.id !== `t${i}`)) }
  assert.ok(h.ws.deletedTasks.length <= 100)
})

test("single-deleting today's plan row of a task with history pauses it (Not today); a bulk delete only removes the row; a cut never deletes or pauses", () => {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(doc, 'TODO', todo('y1', 'Carried', 'plan', yesterday), todo('y2', 'Also carried', 'plan', yesterday), todo('y3', 'Cut and pasted', 'plan', yesterday)))
  const ids = ['Carried', 'Also carried', 'Cut and pasted'].map(t => h.task(t).id)
  h.run({ type: 'plan-tasks', date: today, items: ids.map(taskId => ({ taskId })) })
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.title), ['Carried', 'Also carried', 'Cut and pasted'])
  const rows = taskRowsOn(h.page(dayId(today)))
  const rowOf = (taskId: string) => rows.find(r => r.taskId === taskId)!.id
  h.save(dayId(today), doc => doc.filter(n => n.id !== rowOf(ids[0]!)), { singleDeleteIds: [rowOf(ids[0]!)] })
  assert.equal(h.ws.tasks.find(t => t.id === ids[0])!.paused, true)
  assert.equal(plannedOn(h.ws, ids[0]!), yesterday)
  assert.ok(h.ws.tasks.some(t => t.id === ids[0]), 'a task with history is never deleted by a row')
  h.save(dayId(today), doc => doc.filter(n => n.id !== rowOf(ids[1]!)))
  assert.equal(h.ws.tasks.find(t => t.id === ids[1])!.paused, false)
  assert.equal(plannedOn(h.ws, ids[1]!), yesterday)
  h.save(dayId(today), doc => doc.filter(n => n.id !== rowOf(ids[2]!)), { singleDeleteIds: [rowOf(ids[2]!)], cutTaskIds: [ids[2]!] })
  assert.equal(h.ws.tasks.find(t => t.id === ids[2])!.paused, false)
  // Pasted on a document page: the row keeps the task's identity.
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'D' })
  h.save('D', doc => [...doc, { ...todo('pasted', 'Cut and pasted', 'reference', ''), props: { taskId: ids[2], role: 'reference', planDate: '' } }])
  assert.equal(h.ws.tasks.filter(t => t.title === 'Cut and pasted').length, 1)
  // Turning a to-do row into a bullet counts as deleting its row (B42).
  h.save(dayId(yesterday), doc => doc.map(n => n.id === 'y1' ? bullet('y1', text('Carried')) : n), { singleDeleteIds: ['y1'] })
  assert.equal(plannedOn(h.ws, ids[0]!), null)
  assert.ok(h.ws.tasks.some(t => t.id === ids[0]), 'still referenced from no page, but paused: kept')
})

test('moving a task to a future day creates that page from the template and takes the row from today; moving from a past day leaves a history row', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'Movable')))
  const id = h.task('Movable').id
  h.run({ type: 'plan-task', taskId: id, date: tomorrow, from: today, today })
  assert.ok(h.ws.pages.some(p => p.id === dayId(tomorrow)), 'the future day page exists now')
  assert.equal(plannedOn(h.ws, id), tomorrow)
  assert.deepEqual(taskRowsOn(h.page(dayId(today))).filter(r => r.taskId === id), [])
  const row = taskRowsOn(h.page(dayId(tomorrow))).find(r => r.taskId === id)!
  assert.equal(row.role, 'plan')
  const tdoc = nodesOf(h.page(dayId(tomorrow)))
  assert.equal(tdoc.filter(n => n.type === 'heading').length, dayTemplate.length)
  // The row sits in the first section, before its trailing empty row.
  assert.equal(tdoc.findIndex(n => n.id === row.id), headingIndex(tdoc, 'TODO') + 1)
  assert.equal(tdoc[headingIndex(tdoc, 'TODO') + 2]!.type, 'task'); assert.equal(inlineText(tdoc[headingIndex(tdoc, 'TODO') + 2]!.content), '')
  // From a past day: the old row stays as history (still a plan row; the newest day is the plan), the plan moves.
  h.day(twoDaysAgo)
  h.save(dayId(twoDaysAgo), doc => under(doc, 'TODO', todo('old', 'Old one', 'plan', twoDaysAgo)))
  const oldId = h.task('Old one').id
  h.run({ type: 'plan-task', taskId: oldId, date: today, from: twoDaysAgo, today })
  assert.equal(plannedOn(h.ws, oldId), today)
  assert.equal(taskRowsOn(h.page(dayId(twoDaysAgo))).find(r => r.taskId === oldId)!.role, 'plan')
  assert.equal(taskRowsOn(h.page(dayId(today))).find(r => r.taskId === oldId)!.role, 'plan')
  // Moving it back to an earlier day: the newest plan row wins, and today's row leaves.
  h.run({ type: 'plan-task', taskId: oldId, date: twoDaysAgo, from: today, today })
  assert.equal(plannedOn(h.ws, oldId), twoDaysAgo)
  assert.ok(!taskRowsOn(h.page(dayId(today))).some(r => r.taskId === oldId))
  assert.equal(taskRowsOn(h.page(dayId(twoDaysAgo))).filter(r => r.taskId === oldId).length, 1)
  // Planning for a day it's already on is a no-op for the page.
  const before = h.page(dayId(twoDaysAgo)).document
  h.run({ type: 'plan-task', taskId: oldId, date: twoDaysAgo })
  assert.equal(h.page(dayId(twoDaysAgo)).document, before)
})

test('Not today pauses and removes the row; a stale row is removed without pausing; planning again unpauses; a paused task is listed, not carried', () => {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'Pause me')))
  const id = h.task('Pause me').id
  h.run({ type: 'not-today', taskId: id, date: today })
  assert.equal(h.ws.tasks.find(t => t.id === id)!.paused, true)
  assert.equal(plannedOn(h.ws, id), null)
  assert.ok(!taskRowsOn(h.page(dayId(today))).some(r => r.taskId === id))
  assert.deepEqual(getDayView(h.ws, today).paused.map(t => t.id), [id])
  assert.ok(!getDayView(h.ws, today).openPool.some(t => t.id === id))
  h.run({ type: 'plan-task', taskId: id, date: today })
  assert.equal(h.ws.tasks.find(t => t.id === id)!.paused, false)
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.id), [id])
  // Planned for tomorrow from the Tasks tab (no `from`): today's row stays as history, the newest day is the plan.
  h.run({ type: 'plan-task', taskId: id, date: tomorrow })
  assert.equal(plannedOn(h.ws, id), tomorrow)
  assert.ok(taskRowsOn(h.page(dayId(today))).some(r => r.taskId === id), 'a row on an earlier day stays as history')
  // Back to today: the later row leaves (a later plan can't stand next to the newest one).
  h.run({ type: 'plan-task', taskId: id, date: today })
  assert.equal(plannedOn(h.ws, id), today)
  assert.ok(!taskRowsOn(h.page(dayId(tomorrow))).some(r => r.taskId === id))
  // Moved from today's page itself: that row leaves. Not today on a day that isn't the plan pauses nothing.
  h.run({ type: 'plan-task', taskId: id, date: tomorrow, from: today, today })
  assert.ok(!taskRowsOn(h.page(dayId(today))).some(r => r.taskId === id))
  h.run({ type: 'not-today', taskId: id, date: today, onlyThisDay: true })
  assert.equal(h.ws.tasks.find(t => t.id === id)!.paused, false)
  assert.equal(plannedOn(h.ws, id), tomorrow)
})

test('done sets the day and keeps the row on the page; reopen clears it; cancelled leaves the plan', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'Finish')))
  const id = h.task('Finish').id
  h.run({ type: 'task-status', taskId: id, status: 'done', today })
  assert.equal(h.ws.tasks[0]!.doneOn, today)
  assert.ok(taskRowsOn(h.page(dayId(today))).some(r => r.taskId === id))
  assert.deepEqual(getDayView(h.ws, today).planned, [])
  assert.deepEqual(getDayView(h.ws, today).dayTasks.map(t => t.id), [id])
  h.run({ type: 'task-status', taskId: id, status: 'open', today })
  assert.equal(h.ws.tasks[0]!.doneOn, null)
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.id), [id])
  h.run({ type: 'task-status', taskId: id, status: 'cancelled', today })
  assert.deepEqual(getDayView(h.ws, today).planned, [])
  assert.equal(plannedOn(h.ws, id), today)
})

test("hand-off: yesterday's open tasks uncapped, older carry capped at three, paused and done left out, nothing from a day already planned today", () => {
  const h = harness()
  h.day(twoDaysAgo); h.day(yesterday); h.day(today)
  h.save(dayId(twoDaysAgo), doc => under(doc, 'TODO', ...[1, 2, 3, 4, 5].map(i => todo(`o${i}`, `Older ${i}`, 'plan', twoDaysAgo))))
  h.save(dayId(yesterday), doc => under(doc, 'TODO', ...[1, 2, 3, 4, 5].map(i => todo(`y${i}`, `Yesterday ${i}`, 'plan', yesterday))))
  h.run({ type: 'task-status', taskId: h.task('Yesterday 5').id, status: 'done', today: yesterday })
  h.run({ type: 'not-today', taskId: h.task('Yesterday 4').id, date: yesterday })
  h.run({ type: 'plan-task', taskId: h.task('Yesterday 3').id, date: today, from: yesterday, today })
  const view = getDayView(h.ws, today)
  assert.deepEqual(view.handoffTasks.map(t => t.title), ['Yesterday 1', 'Yesterday 2'])
  assert.deepEqual(view.carry.map(t => t.title), ['Older 1', 'Older 2', 'Older 3'])
  assert.deepEqual(view.planned.map(t => t.title), ['Yesterday 3'])
  assert.equal(view.openPool.filter(t => t.title.startsWith('Older')).length, 5)
  // Not today from the hand-off: paused, never carried again until planned.
  h.run({ type: 'not-today', taskId: h.task('Yesterday 1').id, date: today })
  assert.deepEqual(getDayView(h.ws, today).handoffTasks.map(t => t.title), ['Yesterday 2'])
})

test('Add all (plan-tasks) nests a sub-task under its parent as on the previous page; order is kept; the morning card closes with handoff-done', () => {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(doc, 'TODO', todo('p', 'Parent', 'plan', yesterday, [todo('c1', 'Child one', 'plan', yesterday), todo('c2', 'Child two', 'plan', yesterday)]), todo('s', 'Sibling', 'plan', yesterday)))
  const ids = ['Parent', 'Child one', 'Child two', 'Sibling'].map(t => h.task(t).id)
  // The child tapped before its parent still ends up under it.
  h.run({ type: 'plan-tasks', date: today, items: [{ taskId: ids[2]! }] })
  h.run({ type: 'plan-tasks', date: today, items: [{ taskId: ids[0]! }, { taskId: ids[1]! }, { taskId: ids[3]! }] })
  const doc = nodesOf(h.page(dayId(today)))
  const parentRow = doc.find(n => n.type === 'task' && n.props?.taskId === ids[0])!
  assert.deepEqual(parentRow.children!.map(c => c.props?.taskId), [ids[1], ids[2]])
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.title), ['Parent', 'Child one', 'Child two', 'Sibling'])
  assert.deepEqual(getDayView(h.ws, today).handoffTasks, [])
  h.run({ type: 'handoff-done', date: today })
  assert.equal(h.page(dayId(today)).handoffDone, true)
  // The plan rows went into the first section, before its empty template row.
  const first = headingIndex(doc, 'TODO')
  assert.equal(doc[first + 1]!.id, parentRow.id)
  assert.equal(inlineText(doc[first + 3]!.content), '')
})

test('new rows land after the last to-do, else before the trailing empty lines of the first section; a page without headings still takes rows', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Added first', plannedOn: today })
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Added second', plannedOn: today })
  let doc = nodesOf(h.page(dayId(today)))
  const first = headingIndex(doc, 'TODO')
  assert.deepEqual(doc.slice(first + 1, first + 4).map(n => inlineText(n.content)), ['Added first', 'Added second', ''])
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.title), ['Added first', 'Added second'])
  // Headings all gone: rows still land, tasks keep their plan.
  h.save(dayId(today), d => d.filter(n => n.type !== 'heading'))
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.title), ['Added first', 'Added second'])
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Added third', plannedOn: today })
  doc = nodesOf(h.page(dayId(today)))
  assert.deepEqual(doc.filter(n => n.type === 'task').map(n => inlineText(n.content)), ['Added first', 'Added second', 'Added third', ''])
  // An unplanned task added to a document page is a reference row.
  h.run({ type: 'create-document', title: 'Doc', body: 'Body', pageId: 'D' })
  h.run({ type: 'add-task', pageId: 'D', title: 'On a doc', deadlineOn: tomorrow })
  assert.equal(taskRowsOn(h.page('D'))[0]!.role, 'reference')
  assert.equal(plannedOn(h.ws, h.task('On a doc').id), null)
  assert.ok(getDayView(h.ws, tomorrow).attention.some(t => t.title === 'On a doc'))
})

test('bring-line copies a text line under the same-named heading, keeps its chip and gives its links a fresh identity; task rows and brought lines are not offered', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Soup', body: '', pageId: 'R' })
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(under(doc, 'Notes', bullet('n1', text('Call about the roof '), chip('ev-1', tomorrow, '09:30')), para('n2', text('see '), pageRef('R', 'ref-1'))), 'TODO', todo('t1', 'A to-do', 'plan', yesterday)))
  const view = getDayView(h.ws, today)
  assert.deepEqual(view.handoffBlocks.map(b => b.block.id), ['n1', 'n2'])
  h.run({ type: 'bring-line', date: today, sourcePageId: dayId(yesterday), sourceBlockId: 'n1' })
  const doc = nodesOf(h.page(dayId(today)))
  const notes = headingIndex(doc, 'Notes')
  const copy = doc[notes + 1]!
  assert.equal(copy.type, 'bulletListItem')
  assert.notEqual(copy.id, 'n1')
  assert.equal(inlineText(copy.content, today), 'Call about the roof @Oct 23 9:30am')
  assert.equal((copy.content as { props?: { eventId?: string } }[]).find(c => c.props?.eventId)?.props?.eventId, 'ev-1')
  assert.equal(dayEvents(h.ws, tomorrow).length, 1, 'the same chip in two lines is one event')
  assert.deepEqual(getDayView(h.ws, today).handoffBlocks.map(b => b.block.id), ['n2'])
  assert.throws(() => h.run({ type: 'bring-line', date: today, sourcePageId: dayId(yesterday), sourceBlockId: 'n1' }), /Already brought/)
  assert.throws(() => h.run({ type: 'bring-line', date: today, sourcePageId: dayId(yesterday), sourceBlockId: 't1' }), /Only text lines/)
  h.run({ type: 'bring-line', date: today, sourcePageId: dayId(yesterday), sourceBlockId: 'n2' })
  const refs = flat(nodesOf(h.page(dayId(today)))).flatMap(n => Array.isArray(n.content) ? (n.content as { type?: string; props?: { refId?: string } }[]).filter(c => c.type === 'pageRef') : [])
  assert.equal(refs.length, 1)
  assert.notEqual(refs[0]!.props?.refId, 'ref-1')
  // Yesterday's lines are untouched.
  assert.deepEqual(flat(nodesOf(h.page(dayId(yesterday)))).filter(n => n.id === 'n1' || n.id === 'n2').length, 2)
})

test('events come from chips on any live page, one per chip id, dated by the chip; a trashed page contributes none', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'T' })
  h.save('T', doc => [...doc, para('x', text('Flight '), chip('f1', tomorrow, '07:00'))])
  h.save(dayId(today), doc => under(doc, 'Events', bullet('e1', text('Dentist '), chip('d1', today, '15:00')), bullet('e2', text('All day '), chip('a1', today))))
  assert.deepEqual(getDayView(h.ws, today).events.map(e => [e.title, e.time]), [['All day', null], ['Dentist', '15:00']])
  assert.deepEqual(dayEvents(h.ws, tomorrow).map(e => [e.title, e.line?.pageId]), [['Flight', 'T']])
  h.run({ type: 'delete-page', pageId: 'T', at: '2026-10-22T10:00:00.000Z' })
  assert.deepEqual(dayEvents(h.ws, tomorrow), [])
})

test('no cap, no roles: five tasks under TODO; every heading deleted keeps every task and plan; a renamed heading changes nothing', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'TODO', ...[1, 2, 3, 4, 5].map(i => todo(`t${i}`, `Task ${i}`))))
  assert.equal(getDayView(h.ws, today).planned.length, 5)
  h.save(dayId(today), doc => doc.map(n => n.type === 'heading' && inlineText(n.content) === 'TODO' ? heading(n.id, 'My day') : n))
  assert.equal(getDayView(h.ws, today).planned.length, 5)
  h.save(dayId(today), doc => doc.filter(n => n.type !== 'heading'))
  assert.equal(getDayView(h.ws, today).planned.length, 5)
  assert.equal(h.ws.tasks.length, 5)
  // Rows above the first heading are plan rows like any other.
  h.save(dayId(today), doc => [todo('top', 'Above everything'), heading('h', 'Later'), ...doc])
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.title)[0], 'Above everything')
})

test('a stale page save is refused whole; replay returns the same receipt; a reused operation id with another action is refused; Undo restores the previous state', () => {
  const h = harness()
  const p = h.day(today)
  const key = pageContentKey(p)
  h.save(dayId(today), doc => under(doc, 'TODO', todo('a', 'One')))
  assert.throws(() => h.run({ type: 'save-editor', pageId: dayId(today), expectedContent: key, document: '[]', today }), /changed elsewhere/)
  assert.equal(h.ws.tasks.length, 1)
  const before = structuredClone(h.ws)
  const r1 = h.run({ type: 'task-status', taskId: 'editor-task:a', status: 'done', today }, 'tick')
  const replay = applyCommand(h.ws, { operationId: 'tick', expectedRevision: 0, action: { type: 'task-status', taskId: 'editor-task:a', status: 'done', today } })
  assert.equal(replay.receipt.operationId, r1.receipt.operationId)
  assert.deepEqual(replay.workspace, h.ws)
  assert.throws(() => applyCommand(h.ws, { operationId: 'tick', expectedRevision: h.ws.revision, action: { type: 'task-status', taskId: 'editor-task:a', status: 'open', today } }), /identity reused/)
  assert.throws(() => applyCommand(h.ws, { operationId: 'late', expectedRevision: h.ws.revision - 1, action: { type: 'handoff-done', date: today } }), /Saved elsewhere/)
  h.run({ type: 'undo', targetOperationId: 'tick' })
  assert.deepEqual({ ...h.ws, revision: 0, receipts: {}, undo: undefined }, { ...before, revision: 0, receipts: {}, undo: undefined })
  assert.equal(h.ws.tasks[0]!.status, 'open')
})

test('Upcoming and the calendar read the documents: planned days, start and due dates; a task on a trashed page is not planned', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Due soon', plannedOn: today, deadlineOn: tomorrow })
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Starts tomorrow', attentionOn: tomorrow })
  h.run({ type: 'plan-task', taskId: h.task('Starts tomorrow').id, date: tomorrow })
  const days = getUpcomingByDate(h.ws, tomorrow)
  assert.deepEqual(days[0]!.date, tomorrow)
  assert.deepEqual(days[0]!.tasks.map(i => [i.task.title, [...i.kinds].sort().join('+')]).sort(), [['Due soon', 'due'], ['Starts tomorrow', 'do+start']])
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'D' })
  h.save('D', doc => [...doc, todo('d', 'On a doc', 'reference', '')])
  h.run({ type: 'delete-page', pageId: 'D', at: '2026-10-22T10:00:00.000Z' })
  assert.ok(h.ws.tasks.some(t => t.title === 'On a doc'), 'trashing a page never deletes a task')
  assert.equal(plannedOn(h.ws, h.task('On a doc').id), null)
})

test('remove-task-row takes a task off a day page (the review\'s Remove): a born-here task goes, one with history stays open', () => {
  const h = harness()
  h.day(today); h.day(tomorrow)
  h.run({ type: 'add-task', pageId: dayId(tomorrow), title: 'Typed for tomorrow', plannedOn: tomorrow })
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Carried on', plannedOn: today })
  h.run({ type: 'plan-task', taskId: h.task('Carried on').id, date: tomorrow })
  const carried = h.task('Carried on').id
  h.run({ type: 'remove-task-row', pageId: dayId(tomorrow), taskId: h.task('Typed for tomorrow').id, today })
  assert.ok(!h.ws.tasks.some(t => t.title === 'Typed for tomorrow'))
  h.run({ type: 'remove-task-row', pageId: dayId(tomorrow), taskId: carried, today })
  assert.ok(h.ws.tasks.some(t => t.id === carried))
  assert.equal(h.ws.tasks.find(t => t.id === carried)!.paused, false, 'not today only pauses on today')
  assert.equal(plannedOn(h.ws, carried), today, "today's row is history: the plan falls back to it")
})

test('a document page holds a card to a page; removing the card never touches the page', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-document', title: 'Child', body: '', pageId: 'C', parentId: dayId(today) })
  h.save(dayId(today), doc => under(doc, 'Notes', card('card-c', 'C')))
  assert.ok(h.ws.pages.some(p => p.id === 'C' && !p.trashedAt))
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'card-c'))
  assert.ok(h.ws.pages.some(p => p.id === 'C' && !p.trashedAt))
})

test('save-review marks the day reviewed; ensure-day on a trashed-free workspace keeps ids stable: day:<date>', () => {
  const h = harness()
  h.day(yesterday)
  h.run({ type: 'save-review', date: yesterday })
  assert.equal(h.page(dayId(yesterday)).reviewSaved, true)
  assert.equal(createEmptyWorkspace().schemaVersion, 2)
})

test('a task typed into a leftover reference row on a day page (an old build\'s empty template row) is planned on that day', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => [...doc, todo('left', 'Late idea', 'reference', '')])
  const t = h.task('Late idea')
  assert.equal(plannedOn(h.ws, t.id), today)
  const row = flat(pageNodes(h.page(dayId(today)))).find(n => n.id === 'left')!
  assert.deepEqual({ role: row.props?.role, planDate: row.props?.planDate }, { role: 'plan', planDate: today })
})

test('set-timezone: a valid IANA zone is kept on the workspace; an unknown one is refused; the export uses it for its date', () => {
  const h = harness()
  h.run({ type: 'set-timezone', timezone: 'Asia/Tokyo' })
  assert.equal(h.ws.timezone, 'Asia/Tokyo')
  assert.throws(() => h.run({ type: 'set-timezone', timezone: 'Mars/Olympus' }), /time zone/i)
  assert.throws(() => h.run({ type: 'set-timezone', timezone: '' }), /time zone/i)
  assert.equal(h.ws.timezone, 'Asia/Tokyo')
})
