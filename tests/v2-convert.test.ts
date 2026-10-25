import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { convertV1, upgradeWorkspace } from '../src/domain/convert-v1.ts'
import { getDayView, plannedOn } from '../src/domain/workspace.ts'
import { inlineText, pageNodes } from '../src/domain/editor-document.ts'
import { dayEvents } from '../src/domain/chip-events.ts'
import { linkedFrom } from '../src/domain/page-tree.ts'
import { flat } from './v2-helpers.ts'

// The fixture was built with the v1 code on main efa4d50 (tests/fixtures/v1): Oct 20–24, nested tasks, a done and a
// paused task, a plan on Oct 23 with no page, a capture-made event, two saved links, a bookmark page, a [[ link, a
// trashed page, a review saved and a morning card done.
const v1 = () => JSON.parse(readFileSync(new URL('./fixtures/v1/workspace.json', import.meta.url), 'utf8')) as Record<string, unknown>
const today = '2026-10-22'
const taskRows = (ws: ReturnType<typeof convertV1>, pageId: string) => flat(pageNodes(ws.pages.find(p => p.id === pageId)!)).filter(n => n.type === 'task').map(n => ({ id: n.id, taskId: String(n.props?.taskId), role: String(n.props?.role), text: inlineText(n.content), children: (n.children ?? []).map(c => String(c.props?.taskId)) }))

test('convert: page and task ids kept, old copies dropped, schema 2, revision and receipts kept', () => {
  const raw = v1(), ws = convertV1(raw, today)
  assert.equal(ws.schemaVersion, 2)
  assert.equal(ws.revision, raw.revision)
  assert.deepEqual(Object.keys(ws.receipts), Object.keys(raw.receipts as object))
  assert.equal(ws.undo, undefined)
  assert.deepEqual(ws.pages.map(p => p.id).sort(), (raw.pages as { id: string }[]).map(p => p.id).concat('day:2026-10-23').sort())
  assert.deepEqual(ws.tasks.map(t => t.id).sort(), (raw.tasks as { id: string }[]).map(t => t.id).sort())
  for (const p of ws.pages) {
    assert.deepEqual(Object.keys(p).filter(k => !['id', 'type', 'date', 'title', 'url', 'parentId', 'trashedAt', 'trashId', 'document', 'handoffDone', 'reviewSaved'].includes(k)), [])
    assert.ok(Array.isArray(JSON.parse(p.document)))
  }
  for (const t of ws.tasks) assert.deepEqual(Object.keys(t).filter(k => !['id', 'title', 'status', 'version', 'paused', 'deadlineOn', 'attentionOn', 'createdOn', 'sourcePageId', 'doneOn'].includes(k)), [])
  assert.deepEqual(ws.deletedTasks, [])
  assert.deepEqual(Object.keys(ws).sort(), ['deletedTasks', 'pages', 'receipts', 'revision', 'schemaVersion', 'tasks', 'timezone'])
})

test('convert: every task is planned on the day the old field said; roles follow the old placements, not the section', () => {
  const raw = v1(), ws = convertV1(raw, today)
  for (const t of raw.tasks as { id: string; title: string; plannedOn: string | null; status: string; paused: boolean; doneOn?: string }[]) {
    assert.equal(plannedOn(ws, t.id), t.plannedOn, t.title)
    const now = ws.tasks.find(x => x.id === t.id)!
    assert.equal(now.status, t.status); assert.equal(now.paused, t.paused); assert.equal(now.doneOn ?? null, t.doneOn ?? null)
  }
  // "Starts Thursday" sat under TODO - Other with a plan row but was never planned: its row is a reference now.
  const starts = (raw.tasks as { id: string; title: string }[]).find(t => t.title === 'Starts Thursday')!.id
  assert.equal(taskRows(ws, 'day:2026-10-22').find(r => r.taskId === starts)!.role, 'reference')
  // Carried with nesting: the parent row on Oct 22 holds the child.
  assert.deepEqual(taskRows(ws, 'day:2026-10-22').find(r => r.taskId === 'editor-task:p1')!.children, ['editor-task:c1'])
  assert.deepEqual(getDayView(ws, today).planned.map(t => t.title), ['Parent task', 'Child task', 'Due Friday'])
  // Oct 21's rows stay as they were typed, as history: still plan rows, the newer day wins.
  assert.deepEqual(taskRows(ws, 'day:2026-10-21').map(r => [r.text, r.role]), [['Parent task', 'plan'], ['Child task', 'plan'], ['Other one', 'plan'], ['Other two with deadline', 'plan']])
})

test('convert: a plan on a day with no page gets the page and its row; the page has the template headings', () => {
  const ws = convertV1(v1(), today)
  const p = ws.pages.find(x => x.id === 'day:2026-10-23')!
  assert.equal(p.type, 'daily'); assert.equal(p.date, '2026-10-23')
  const rows = taskRows(ws, 'day:2026-10-23')
  assert.deepEqual(rows.filter(r => r.text).map(r => [r.text, r.role]), [['Planned for Thursday', 'plan']])
  assert.ok(pageNodes(p).some(n => n.type === 'heading'))
  assert.deepEqual(taskRows(ws, 'day:2026-10-24').filter(r => r.text).map(r => [r.text, r.role]), [['Planned for Saturday', 'plan']])
})

test('convert: the stored event becomes a line with a chip; chip events are kept; saved links become link lines and bookmark pages stay', () => {
  const ws = convertV1(v1(), today)
  const monday = dayEvents(ws, '2026-10-20')
  assert.deepEqual(monday.map(e => [e.title, e.time, e.line?.pageId]), [['Dentist', '15:00', 'day:2026-10-20']])
  assert.deepEqual(dayEvents(ws, '2026-10-23').map(e => [e.title, e.time]), [['Call about the roof', '09:30']])
  const mondayDoc = flat(pageNodes(ws.pages.find(p => p.id === 'day:2026-10-20')!))
  const link = mondayDoc.find(n => JSON.stringify(n.content).includes('inkandswitch'))!
  assert.equal(link.type, 'paragraph')
  assert.equal((link.content as { type: string; href?: string }[])[0]!.type, 'link')
  const bookmark = ws.pages.find(p => p.id === 'L1')!
  assert.equal(bookmark.url, 'https://example.com/article'); assert.equal(bookmark.title, 'An article'); assert.equal(bookmark.parentId, 'day:2026-10-21')
  assert.ok(flat(pageNodes(ws.pages.find(p => p.id === 'day:2026-10-21')!)).some(n => n.type === 'pageLink' && n.props?.pageId === 'L1'))
})

test('convert: [[ links keep their time and target; Linked from and the trash survive; flags survive', () => {
  const ws = convertV1(v1(), today)
  const refLine = flat(pageNodes(ws.pages.find(p => p.id === 'day:2026-10-21')!)).find(n => n.id === 'n-ref')!
  const ref = (refLine.content as { type: string; props?: Record<string, unknown> }[]).find(c => c.type === 'pageRef')!
  assert.equal(ref.props!.pageId, 'R'); assert.equal(typeof ref.props!.at, 'number')
  assert.deepEqual(linkedFrom(ws, 'R').map(e => e.page.id), ['day:2026-10-21'])
  assert.ok(ws.pages.find(p => p.id === 'T')!.trashedAt)
  assert.equal(ws.pages.find(p => p.id === 'day:2026-10-22')!.handoffDone, true)
  assert.equal(ws.pages.find(p => p.id === 'day:2026-10-21')!.reviewSaved, true)
  assert.equal(ws.pages.find(p => p.id === 'R-child')!.parentId, 'R')
})

test('convert: idempotent on a v2 workspace, and refused for an unknown shape', () => {
  const ws = convertV1(v1(), today)
  assert.deepEqual(upgradeWorkspace(structuredClone(ws), today), ws)
  assert.deepEqual(upgradeWorkspace(v1(), today), ws)
  assert.throws(() => upgradeWorkspace({ schemaVersion: 9 }, today), /Unsupported/)
})
