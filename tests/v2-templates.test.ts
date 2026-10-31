import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, yesterday, text, todo, bullet, para, heading, chip, pageRef, card, flat, nodesOf, under } from './v2-helpers.ts'
import { createEmptyWorkspace, getDayView, taskRows } from '../src/domain/workspace.ts'
import { dayPagesTarget, defaultTemplate, isTemplate, templates } from '../src/domain/day-template.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'
import { childPages, isBlankWorkspace, linkedFrom, moveTargets, recentPages, visiblePages } from '../src/domain/page-tree.ts'
import { buildSearchIndex } from '../src/domain/search.ts'
import { tagIndex } from '../src/domain/tags.ts'
import { dayEvents } from '../src/domain/chip-events.ts'
import { exportFiles } from '../src/domain/export.ts'
import { pageOf, pageRow, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'

const words = (nodes: EditorNode[]) => nodes.map(n => [n.type, inlineText(n.content).trim()])

/** A workspace whose "Day" template was made from the built-in headings and is the day pages' default. */
function withDayTemplate() {
  const h = harness()
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  return h
}

test('templates: with no template, a new day page gets the built-in four headings as before', () => {
  const h = harness()
  assert.deepEqual(words(nodesOf(h.day(today))).filter(([type]) => type === 'heading').map(([, w]) => w), ['TODO', 'Events', 'Good Stuffs', 'Notes'])
  assert.equal(templates(h.ws).length, 0)
})

test('templates: Edit makes "Day" from the built-in headings, the default for day pages; the next day page copies it', () => {
  const h = withDayTemplate()
  const t = h.page('tpl')
  assert.ok(isTemplate(t))
  assert.equal(t.title, 'Day')
  assert.equal(defaultTemplate(h.ws, dayPagesTarget)?.id, 'tpl')
  assert.deepEqual(words(nodesOf(t)).filter(([type]) => type === 'heading').map(([, w]) => w), ['TODO', 'Events', 'Good Stuffs', 'Notes'])
  h.save('tpl', () => [heading('h1', 'Plan'), todo('t1', 'Water plants', 'reference', ''), heading('h2', 'Journal'), para('p1', text('Gym?')), bullet('b1', text('Mood: '))])
  const day = h.day(tomorrow)
  assert.deepEqual(words(nodesOf(day)), [['heading', 'Plan'], ['task', ''], ['heading', 'Journal'], ['paragraph', 'Gym?'], ['bulletListItem', 'Mood:']])
})

test('templates: a template save never makes, renames or settles a task, and a real to-do pasted in leaves its task alone', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('real', 'Call the bank')))
  const real = h.task('Call the bank')
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  const before = h.ws.tasks.length
  h.save('tpl', () => [heading('h1', 'Plan'), todo('t1', 'Water plants', 'reference', ''), { ...todo('pasted', 'Renamed here'), props: { taskId: real.id, role: 'plan', planDate: today } }])
  assert.equal(h.ws.tasks.length, before)
  assert.equal(h.task('Call the bank').version, real.version)
  assert.ok(!h.ws.tasks.some(t => t.title === 'Water plants' || t.title === 'Renamed here'))
  const rows = flat(nodesOf(h.page('tpl'))).filter(n => n.type === 'task')
  assert.deepEqual(rows.map(n => n.props?.taskId), ['editor-task:t1', 'editor-task:pasted'])
  // Removing the row from the template later doesn't touch the real task either.
  h.save('tpl', () => [heading('h1', 'Plan')])
  assert.equal(h.task('Call the bank').status, 'open')
  assert.ok(getDayView(h.ws, today).planned.some(t => t.id === real.id))
})

test('templates: the copy has fresh ids everywhere, empty unticked to-dos with fresh task ids, nesting kept, and no page cards', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Weekly goals', body: '', pageId: 'goals' })
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  const nested = { ...todo('t1', 'Water plants', 'reference', ''), children: [todo('t2', 'Front', 'reference', '')] }
  h.save('tpl', () => [heading('h1', 'Plan'), nested, para('p1', text('See '), pageRef('goals', 'ref-1', { at: '3' }), text(' at '), chip('ev-1', tomorrow, '09:00')), card('c1', 'goals')])
  const a = h.day(tomorrow), b = h.day('2026-10-24')
  const tplIds = new Set(flat(nodesOf(h.page('tpl'))).map(n => n.id))
  for (const p of [a, b]) {
    const nodes = flat(nodesOf(p))
    assert.ok(nodes.every(n => !tplIds.has(n.id)), 'block ids are fresh')
    assert.ok(!nodes.some(n => n.type === 'pageLink'), 'page cards are not copied')
    const rows = nodes.filter(n => n.type === 'task')
    assert.equal(rows.length, 2)
    assert.ok(rows.every(n => inlineText(n.content) === '' && n.props?.taskId === `editor-task:${n.id}` && n.props?.role === 'plan' && n.props?.planDate === p.date))
    assert.equal(nodesOf(p)[1]!.children?.length, 1, 'nesting kept')
  }
  const refs = [a, b].map(p => (flat(nodesOf(p)).find(n => n.type === 'paragraph')!.content as { type: string; props: Record<string, unknown> }[]))
  const refIds = refs.map(c => c.find(x => x.type === 'pageRef')!.props)
  assert.ok(refIds.every(r => r.pageId === 'goals' && r.refId !== 'ref-1' && r.at === undefined))
  assert.notEqual(refIds[0]!.refId, refIds[1]!.refId)
  const eventIds = refs.map(c => c.find(x => x.type === 'dateMention')!.props.eventId)
  assert.ok(eventIds.every(id => id !== 'ev-1'))
  assert.notEqual(eventIds[0], eventIds[1])
  // Two days, two events: the copies don't merge into one, and the template's own chip is no event.
  assert.equal(dayEvents(h.ws, tomorrow).length, 2)
  assert.equal(h.ws.tasks.length, 0, 'copying makes no task')
})

test('templates: carried and Tomorrow to-dos go under the first section with a to-do row, even when it is not the first heading', () => {
  const h = harness()
  h.day(yesterday)
  h.save(dayId(yesterday), d => under(d, 'TODO', todo('carry', 'Carry me', 'plan', yesterday)))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('h1', 'Journal'), bullet('b1'), heading('h2', 'Plan'), todo('t1', '', 'reference', ''), heading('h3', 'Notes'), bullet('b2')])
  h.day(today)
  const carried = h.task('Carry me')
  h.run({ type: 'plan-tasks', date: today, items: [{ taskId: carried.id }] })
  const nodes = nodesOf(h.page(dayId(today)))
  const at = nodes.findIndex(n => n.props?.taskId === carried.id)
  const plan = nodes.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Plan')
  const notes = nodes.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes')
  assert.ok(at > plan && at < notes, `carried row at ${at}, Plan ${plan}, Notes ${notes}`)
  h.run({ type: 'add-task', pageId: dayId(today), title: 'From Tomorrow', plannedOn: today })
  const added = nodesOf(h.page(dayId(today))).findIndex(n => n.props?.taskId === h.task('From Tomorrow').id)
  assert.ok(added > plan && added < notes)
})

test('templates: a to-do typed on a day made from the template is a normal task', () => {
  const h = withDayTemplate()
  const day = h.day(today)
  const row = flat(nodesOf(day)).find(n => n.type === 'task')!
  h.save(dayId(today), d => d.map(n => (n.id === row.id ? { ...n, content: [text('Pay rent')] } : n)))
  assert.equal(h.task('Pay rent').id, row.props?.taskId)
  assert.ok(getDayView(h.ws, today).planned.some(t => t.title === 'Pay rent'))
})

test('templates: one default per target; a second template takes day pages, None clears it, Undo gives it back', () => {
  const h = withDayTemplate()
  h.ws = { ...h.ws, pages: [...h.ws.pages, { id: 'tpl-2', type: 'template', date: null, title: 'Busy day', document: JSON.stringify([heading('x', 'Only this')]) }] }
  const moved = h.run({ type: 'set-template-target', pageId: 'tpl-2', target: 'days' })
  assert.equal(defaultTemplate(h.ws, dayPagesTarget)?.id, 'tpl-2')
  assert.equal(h.page('tpl').parentId, undefined)
  h.run({ type: 'undo', targetOperationId: moved.receipt.operationId })
  assert.equal(defaultTemplate(h.ws, dayPagesTarget)?.id, 'tpl')
  h.run({ type: 'set-template-target', pageId: 'tpl', target: null })
  assert.equal(defaultTemplate(h.ws, dayPagesTarget), undefined)
  assert.deepEqual(words(nodesOf(h.day(tomorrow))).filter(([type]) => type === 'heading').map(([, w]) => w), ['TODO', 'Events', 'Good Stuffs', 'Notes'])
})

test('templates: Bring goes under the same-name heading, else Notes, else the end of the page; no heading comes back', () => {
  const h = harness()
  h.day(yesterday)
  h.save(dayId(yesterday), d => under(d, 'Good Stuffs', bullet('line', text('A good thing'))))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('h1', 'Plan'), todo('t1', '', 'reference', ''), para('p1')])
  h.day(today)
  h.run({ type: 'bring-line', date: today, sourcePageId: dayId(yesterday), sourceBlockId: 'line' })
  const nodes = nodesOf(h.page(dayId(today)))
  assert.deepEqual(nodes.filter(n => n.type === 'heading').map(n => inlineText(n.content)), ['Plan'])
  const at = nodes.findIndex(n => inlineText(n.content) === 'A good thing')
  assert.equal(at, nodes.length - 2, 'before the trailing empty line')
})

test('templates: never listed as a page, searched, tagged, linked from, counted as written, or moved', () => {
  const h = harness(createEmptyWorkspace())
  h.run({ type: 'create-document', title: 'Weekly goals', body: '', pageId: 'goals' })
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('h1', 'Plan #focus'), para('p1', text('Gym? #health '), pageRef('goals', 'ref-1'), chip('ev-1', today))])
  assert.ok(!visiblePages(h.ws).some(isTemplate))
  assert.ok(!childPages(h.ws, null).some(isTemplate))
  assert.ok(!recentPages(h.ws, null).some(isTemplate))
  assert.ok(!moveTargets(h.ws, 'goals').some(isTemplate))
  assert.ok(!buildSearchIndex(h.ws).pages.some(p => isTemplate(p.page)))
  assert.ok(!buildSearchIndex(h.ws).lines.some(l => isTemplate(l.page)))
  assert.ok(!tagIndex(h.ws).some(t => t.tag.includes('health')))
  assert.deepEqual(linkedFrom(h.ws, 'goals'), [])
  assert.equal(dayEvents(h.ws, today).length, 0)
  assert.throws(() => h.run({ type: 'move-page', pageId: 'tpl', parentId: 'goals' }))
  assert.throws(() => h.run({ type: 'move-page', pageId: 'goals', parentId: 'tpl' }))
  assert.throws(() => h.run({ type: 'delete-page', pageId: 'tpl', at: '2026-10-22T10:00:00Z' }))
  assert.throws(() => h.run({ type: 'create-document', title: 'Sub', body: '', parentId: 'tpl' }))
  assert.throws(() => h.run({ type: 'add-task', pageId: 'tpl', title: 'No' }))
  assert.throws(() => h.run({ type: 'make-link-pages', parentPageId: 'tpl', items: [{ url: 'https://example.com', pageId: 'lp' }] }))
  h.run({ type: 'rename-page', pageId: 'tpl', title: 'My day' })
  assert.equal(h.page('tpl').title, 'My day')
  // Deleting a page the template could point at never takes the template with it.
  h.run({ type: 'delete-page', pageId: 'goals', at: '2026-10-22T10:00:00Z' })
  assert.ok(!h.page('tpl').trashedAt)
})

test('templates: a new account that only edited its template still sees the first-day line', () => {
  const h = harness()
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('h1', 'Plan'), para('p1', text('Gym?'))])
  assert.equal(isBlankWorkspace(h.ws), true)
})

test('templates: export keeps them in templates/, marked with their target, not as pages', () => {
  const h = withDayTemplate()
  const files = exportFiles(h.ws, new Date('2026-10-22T17:00:00Z'))
  const file = files.find(f => f.path.endsWith('/templates/Day.md'))
  assert.ok(file)
  assert.match(file!.text, /template-for: "days"/)
  assert.ok(!files.some(f => f.path.includes('/pages/') && f.text.includes('daythread-id: "tpl"')))
  const json = JSON.parse(files.find(f => f.path.endsWith('/workspace.json'))!.text)
  assert.equal(json.pages.find((p: { id: string }) => p.id === 'tpl').markdownFile, 'templates/Day.md')
})

test('templates: the row store keeps type and target as they are', () => {
  const h = withDayTemplate()
  const t = h.page('tpl')
  const row = pageOf(pageRow(t, 1))
  assert.deepEqual([row.type, row.parentId, row.document], [t.type, t.parentId, t.document])
  const back = workspaceOf(rowsOf(h.ws))
  const again = back.pages.find(p => p.id === 'tpl')!
  assert.equal(again.type, 'template')
  assert.equal(again.parentId, 'days')
  assert.equal(defaultTemplate(back, dayPagesTarget)?.id, 'tpl')
})

test('templates: a day page that already exists keeps its layout when the template changes', () => {
  const h = harness()
  const before = h.day(tomorrow).document
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('h1', 'Plan')])
  assert.equal(h.page(dayId(tomorrow)).document, before)
  assert.deepEqual(words(nodesOf(h.day('2026-10-24'))), [['heading', 'Plan']])
})

test('templates: a template row is never a place of a real task, even if it carries that task id', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('real', 'Call the bank')))
  const real = h.task('Call the bank')
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  // Stored as an older build or a bad import might leave it, bypassing the template save's row ids.
  h.ws = { ...h.ws, pages: h.ws.pages.map(p => (p.id === 'tpl' ? { ...p, document: JSON.stringify([{ ...todo('x', 'Call the bank'), props: { taskId: real.id, role: 'plan', planDate: today } }]) } : p)) }
  assert.deepEqual(taskRows(h.ws, real.id).map(r => r.page.id), [dayId(today)])
})
