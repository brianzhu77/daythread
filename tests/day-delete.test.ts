// B16: a day page goes to the trash like any page, and comes back: the date stays free meanwhile, to-dos stay open, and
// a new page of that date joins the restored one, so nothing is lost.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatNodes, inlineText, pageNodes } from '../src/domain/editor-document.ts'
import { fileNames } from '../src/domain/export.ts'
import { pagePath } from '../src/domain/line-link.ts'
import { getDayView, plannedOn, previousDayPage, taskRows } from '../src/domain/workspace.ts'
import type { Page } from '../src/domain/types.ts'
import { harness, para, text, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
const dayId = `day:${today}`
const words = (p: Page) => flatNodes(pageNodes(p)).filter(n => n.type !== 'heading').map(n => inlineText(n.content)).filter(Boolean)

/** Today's page with a line of writing. */
function written(line = 'Slept well') {
  const h = harness()
  h.run({ type: 'ensure-day', date: today })
  h.save(dayId, d => [...d, para(`p-${line}`, text(line))])
  return h
}
const pagesOn = (h: ReturnType<typeof harness>, date = today) => h.ws.pages.filter(p => p.type === 'daily' && p.date === date)

test('a day goes to the trash with its subpages, one count, and Undo puts it all back', () => {
  const h = written()
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'sub', parentId: dayId })
  const r = h.run({ type: 'delete-page', pageId: dayId, at })
  assert.equal(r.receipt.message, 'Moved to trash · 1 subpage')
  assert.ok(h.page(dayId).trashedAt)
  assert.equal(h.page('sub').trashId, h.page(dayId).trashId)
  assert.equal(getDayView(h.ws, today).page, null)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.page(dayId).trashedAt ?? null, null)
  assert.equal(h.page('sub').trashedAt ?? null, null)
  assert.throws(() => { h.run({ type: 'delete-page', pageId: dayId, at }); h.run({ type: 'delete-page', pageId: dayId, at }) }, /in trash/)
})

test("the notice doesn't count a database's rows, or a day's draft, as subpages", () => {
  const h = written()
  h.run({ type: 'create-database', pageId: 'list', parentId: dayId, homeBlockId: 'home', title: 'Reading' })
  for (const id of ['r1', 'r2', 'r3']) h.run({ type: 'add-row', databaseId: 'list', pageId: id, title: id, at })
  h.ws.pages.push({ id: `draft:${dayId}`, type: 'draft', date: null, title: '', parentId: dayId, document: '{}' } as Page)
  assert.equal(h.run({ type: 'delete-page', pageId: dayId, at }).receipt.message, 'Moved to trash · 1 subpage')
})

test('the date is free while its page is in the trash: a new one gets its own id, and a to-do planned there lands on it', () => {
  const h = written()
  const { entityId: task } = h.run({ type: 'add-task', pageId: dayId, title: 'Call Sam', plannedOn: today }).receipt
  h.run({ type: 'delete-page', pageId: dayId, at })
  // The to-do stays open and listed; the row in the trash isn't its place.
  assert.equal(h.ws.tasks.find(t => t.id === task)!.status, 'open')
  assert.equal(plannedOn(h.ws, task!), null)
  assert.ok(getDayView(h.ws, today).openPool.some(t => t.id === task))
  h.run({ type: 'plan-task', taskId: task!, date: today })
  const live = getDayView(h.ws, today).page!
  assert.equal(live.id, `${dayId}:2`)
  assert.equal(live.trashedAt ?? null, null)
  assert.equal(plannedOn(h.ws, task!), today)
  assert.deepEqual(taskRows(h.ws, task!).map(r => r.page.id), [`${dayId}:2`])
})

test('carrying and the draft read the last live day, not one in the trash', () => {
  const h = harness()
  for (const d of ['2026-10-20', '2026-10-21']) h.run({ type: 'ensure-day', date: d })
  assert.equal(previousDayPage(h.ws, '2026-10-22')!.date, '2026-10-21')
  h.run({ type: 'delete-page', pageId: 'day:2026-10-21', at })
  assert.equal(previousDayPage(h.ws, '2026-10-22')!.date, '2026-10-20')
})

test('restored with no new page: as it was, with no duplicate to-do row', () => {
  const h = written()
  const { entityId: task } = h.run({ type: 'add-task', pageId: dayId, title: 'Call Sam', plannedOn: today }).receipt
  const before = h.page(dayId).document
  h.run({ type: 'delete-page', pageId: dayId, at })
  const r = h.run({ type: 'restore-batch', trashId: h.page(dayId).trashId! })
  assert.equal(r.receipt.message, 'Restored')
  assert.equal(h.page(dayId).document, before)
  assert.equal(plannedOn(h.ws, task!), today)
  assert.equal(taskRows(h.ws, task!).length, 1)
})

test('a new page with nothing written is replaced on Restore', () => {
  const h = written()
  h.run({ type: 'delete-page', pageId: dayId, at })
  h.run({ type: 'ensure-day', date: today })
  assert.equal(pagesOn(h).length, 2)
  const r = h.run({ type: 'restore-batch', trashId: h.page(dayId).trashId! })
  assert.equal(r.receipt.message, 'Restored')
  assert.deepEqual(pagesOn(h).map(p => p.id), [dayId])
  assert.deepEqual(words(h.page(dayId)), ['Slept well'])
})

test('a new page with writing joins the restored one below its lines, its subpages come along, and Undo puts both back', () => {
  const h = written()
  h.run({ type: 'delete-page', pageId: dayId, at })
  h.run({ type: 'ensure-day', date: today })
  const newer = `${dayId}:2`
  h.save(newer, d => [...d, para('p-second', text('Second try'))])
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'sub', parentId: newer })
  const newerDoc = h.page(newer).document
  const r = h.run({ type: 'restore-batch', trashId: h.page(dayId).trashId! })
  assert.equal(r.receipt.message, 'Restored · joined with the new page')
  assert.equal(r.receipt.entityId, dayId)
  assert.deepEqual(pagesOn(h).map(p => p.id), [dayId])
  assert.deepEqual(words(h.page(dayId)), ['Slept well', 'Second try'])
  assert.equal(h.page('sub').parentId, dayId)
  assert.equal(getDayView(h.ws, today).page!.id, dayId)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(pagesOn(h).map(p => p.id).sort(), [dayId, newer])
  assert.ok(h.page(dayId).trashedAt)
  assert.equal(h.page(newer).document, newerDoc)
  assert.equal(h.page('sub').parentId, newer)
})

test('a heading he changed on the new page counts as writing, so it joins', () => {
  const h = written()
  h.run({ type: 'delete-page', pageId: dayId, at })
  h.run({ type: 'ensure-day', date: today })
  const newer = `${dayId}:2`
  h.save(newer, d => d.map((n, i) => (i === 0 ? { ...n, content: [text('Big plans')] } : n)))
  assert.equal(h.run({ type: 'restore-batch', trashId: h.page(dayId).trashId! }).receipt.message, 'Restored · joined with the new page')
  assert.ok(h.page(dayId).document.includes('Big plans'))
})

test('deleted twice: each stays its own in the trash, and restoring the second later joins it', () => {
  const h = written('First')
  h.run({ type: 'delete-page', pageId: dayId, at })
  h.run({ type: 'ensure-day', date: today })
  const second = `${dayId}:2`
  h.save(second, d => [...d, para('p-second', text('Second'))])
  h.run({ type: 'delete-page', pageId: second, at: '2026-10-22T19:00:00.000Z' })
  assert.equal(getDayView(h.ws, today).page, null)
  h.run({ type: 'restore-batch', trashId: h.page(second).trashId! })
  assert.ok(h.page(dayId).trashedAt, 'the older one stays in the trash')
  assert.equal(getDayView(h.ws, today).page!.id, second)
  const r = h.run({ type: 'restore-batch', trashId: h.page(dayId).trashId! })
  assert.equal(r.receipt.message, 'Restored · joined with the new page')
  assert.deepEqual(words(getDayView(h.ws, today).page!), ['First', 'Second'])
  // A third page never takes an id still held in the trash.
  h.run({ type: 'delete-page', pageId: dayId, at })
  h.run({ type: 'ensure-day', date: today })
  assert.equal(getDayView(h.ws, today).page!.id, `${dayId}:2`)
})

test("a trashed day opens by its id, and the export names the date's live page plainly", () => {
  const h = written()
  h.run({ type: 'delete-page', pageId: dayId, at })
  assert.equal(pagePath(h.page(dayId)), `/pages?page=${encodeURIComponent(dayId)}`)
  h.run({ type: 'ensure-day', date: today })
  assert.equal(pagePath(h.page(`${dayId}:2`)), `/day/${today}`)
  assert.equal(fileNames(h.ws).get(`${dayId}:2`), today)
})
