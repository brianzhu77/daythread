import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorSeed, inlineText } from '../src/domain/editor-document.ts'
import { childPages, isTrashed, linkedFrom, subtreeIds, trashBatches } from '../src/domain/page-tree.ts'
import { resolveLine } from '../src/domain/page-refs.ts'
import { tagIndex } from '../src/domain/tags.ts'
import { exportFiles, exportJson } from '../src/domain/export.ts'
import { defaultLinkTitle } from '../src/domain/url-key.ts'
import { bullet, card, dayId, flat, harness, nodesOf, pageRef, para, text, today, todo, tomorrow, under, yesterday } from './v2-helpers.ts'

test('pages: create (top level and under a day), rename, move, a cycle refused, delete a subtree, restore one, restore the batch', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-document', title: 'Work', body: 'first line', pageId: 'W' })
  h.run({ type: 'create-document', title: 'Child', body: '', pageId: 'C', parentId: 'W' })
  h.run({ type: 'create-document', title: 'Grandchild', body: '', pageId: 'G', parentId: 'C' })
  h.run({ type: 'create-document', title: 'In a day', body: '', pageId: 'D', parentId: dayId(today) })
  assert.equal(inlineText(nodesOf(h.page('W'))[0]!.content), 'first line')
  h.run({ type: 'rename-page', pageId: 'W', title: 'Work 2026' })
  assert.equal(h.page('W').title, 'Work 2026')
  assert.throws(() => h.run({ type: 'rename-page', pageId: dayId(today), title: 'x' }), /named by their date/)
  assert.throws(() => h.run({ type: 'move-page', pageId: 'W', parentId: 'G' }), /inside itself|its own/i)
  h.run({ type: 'move-page', pageId: 'D', parentId: 'W' })
  assert.deepEqual(childPages(h.ws, 'W').map(p => p.id), ['C', 'D'])
  assert.deepEqual([...subtreeIds(h.ws, 'W')].sort(), ['C', 'D', 'G', 'W'])
  const r = h.run({ type: 'delete-page', pageId: 'W', at: '2026-10-22T12:00:00.000Z' })
  assert.match(r.receipt.message, /3 subpages/)
  assert.deepEqual(h.ws.pages.filter(isTrashed).map(p => p.id).sort(), ['C', 'D', 'G', 'W'])
  assert.equal(trashBatches(h.ws).length, 1)
  h.run({ type: 'restore-page', pageId: 'G' })
  assert.equal(isTrashed(h.page('G')), false)
  assert.equal(h.page('G').parentId ?? null, null, 'restored alone, its parent still in the trash: top level')
  h.run({ type: 'restore-batch', trashId: r.receipt.operationId })
  assert.deepEqual(h.ws.pages.filter(isTrashed), [])
  assert.equal(h.page('C').parentId, 'W')
  assert.throws(() => h.run({ type: 'delete-page', pageId: dayId(today), at: '2026-10-22T12:00:00.000Z' }), /can't be deleted/)
})

test('bookmark pages: one page per URL; a live one is reused, a trashed one restored; the title comes from the link text; the preview fills only an untouched page', () => {
  const h = harness()
  h.day(today)
  const url = 'https://Example.com/Article?x=1'
  h.run({ type: 'make-link-pages', parentPageId: dayId(today), items: [{ url, pageId: 'L1', title: 'An article' }] })
  assert.equal(h.page('L1').url, url)
  assert.equal(h.page('L1').title, 'An article')
  assert.equal(h.page('L1').parentId, dayId(today))
  const again = h.run({ type: 'make-link-pages', parentPageId: dayId(today), items: [{ url: 'https://example.com/Article?x=1', pageId: 'L2' }] })
  assert.equal(again.receipt.entityId, 'L1')
  assert.ok(!h.ws.pages.some(p => p.id === 'L2'))
  h.run({ type: 'make-link-pages', parentPageId: dayId(today), items: [{ url: 'https://example.com/other', pageId: 'L3' }] })
  assert.equal(h.page('L3').title, defaultLinkTitle('https://example.com/other'))
  assert.equal(h.page('L3').title, 'example.com/other')
  h.run({ type: 'delete-page', pageId: 'L3', at: '2026-10-22T12:00:00.000Z' })
  const restored = h.run({ type: 'make-link-pages', parentPageId: dayId(today), items: [{ url: 'https://example.com/other', pageId: 'L4' }] })
  assert.equal(restored.receipt.entityId, 'L3')
  assert.equal(isTrashed(h.page('L3')), false)
  assert.throws(() => h.run({ type: 'make-link-pages', parentPageId: dayId(today), items: [{ url: 'not a url', pageId: 'L5' }] }), /http/)
  // The web preview: title and a quote, once, only while the page is as the paste left it.
  h.run({ type: 'apply-link-preview', pageId: 'L3', url: 'https://example.com/other', title: 'Other things', description: 'A page about other things.' })
  assert.equal(h.page('L3').title, 'Other things')
  assert.equal(nodesOf(h.page('L3'))[0]!.type, 'quote')
  const before = h.page('L3').document
  h.run({ type: 'apply-link-preview', pageId: 'L3', url: 'https://example.com/other', title: 'Changed', description: 'x' })
  assert.equal(h.page('L3').title, 'Other things'); assert.equal(h.page('L3').document, before)
  h.save('L1', doc => [...doc, para('mine', text('my notes'))])
  h.run({ type: 'apply-link-preview', pageId: 'L1', url, title: 'Late title', description: null })
  assert.equal(h.page('L1').title, 'An article')
  // The card on the day page is a reference; the page's url is its own.
  h.save(dayId(today), doc => under(doc, 'Good Stuffs', card('c1', 'L1')))
  assert.deepEqual(linkedFrom(h.ws, 'L1').filter(e => !e.isParent).map(e => e.page.id), [])
  assert.ok(linkedFrom(h.ws, 'L1').some(e => e.page.id === dayId(today) && e.isParent))
})

test('[[ links: stamped once with the revision of their first save, kept across saves and renames; Linked from newest first and never the parent', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Soup', body: '', pageId: 'R' })
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(doc, 'Notes', para('l1', text('see '), pageRef('R', 'r1'))))
  const at = h.ws.revision
  const ref = () => (flat(nodesOf(h.page(dayId(yesterday)))).find(n => n.id === 'l1')!.content as { type: string; props: Record<string, unknown> }[]).find(c => c.type === 'pageRef')!.props
  assert.equal(ref().at, at)
  h.save(dayId(yesterday), doc => [...doc, para('more', text('more'))])
  h.run({ type: 'rename-page', pageId: 'R', title: 'Doenjang' })
  assert.equal(ref().at, at)
  assert.equal(inlineText(editorSeed(h.page(dayId(yesterday)), h.ws).find(n => n.id === 'l1')!.content), 'see ')
  h.save(dayId(today), doc => under(doc, 'Notes', card('c', 'R')))
  h.run({ type: 'create-document', title: 'Child of soup', body: '', pageId: 'K', parentId: 'R' })
  h.save('K', doc => [...doc, para('k1', text('up: '), pageRef('R', 'r2'))])
  assert.deepEqual(linkedFrom(h.ws, 'R').map(e => [e.page.id, e.isParent]), [['K', false], [dayId(today), false], [dayId(yesterday), false]])
  h.run({ type: 'delete-page', pageId: 'K', at: '2026-10-22T12:00:00.000Z' })
  assert.deepEqual(linkedFrom(h.ws, 'R').map(e => [e.page.id, e.removed]), [['K', true], [dayId(today), false], [dayId(yesterday), false]])
})

test('line links resolve: live, moved with its task to another day, not found, and in the trash', () => {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(under(doc, 'Notes', bullet('n1', text('a note'))), 'TODO', todo('t1', 'A task', 'plan', yesterday)))
  const id = h.task('A task').id
  assert.deepEqual(resolveLine(h.ws, { pageId: dayId(yesterday), lineId: 'n1' }), { state: 'live', pageId: dayId(yesterday), blockId: 'n1', words: 'a note' })
  const live = resolveLine(h.ws, { pageId: dayId(yesterday), lineId: 't1', taskId: id })
  assert.equal(live.state, 'live'); assert.equal(live.words, 'A task')
  h.run({ type: 'plan-task', taskId: id, date: today, from: yesterday, today })
  const moved = resolveLine(h.ws, { pageId: dayId(yesterday), lineId: 't1', taskId: id })
  assert.equal(moved.state, 'moved'); assert.equal(moved.pageId, dayId(today)); assert.equal(moved.taskId, id)
  h.save(dayId(yesterday), doc => doc.filter(n => n.id !== 'n1'))
  assert.equal(resolveLine(h.ws, { pageId: dayId(yesterday), lineId: 'n1' }).state, 'line-not-found')
  assert.equal(resolveLine(h.ws, { pageId: 'nowhere', lineId: 'n1' }).state, 'page-not-found')
  h.run({ type: 'create-document', title: 'Doc', body: 'kept', pageId: 'D' })
  const first = nodesOf(h.page('D'))[0]!.id
  h.run({ type: 'delete-page', pageId: 'D', at: '2026-10-22T12:00:00.000Z' })
  assert.equal(resolveLine(h.ws, { pageId: 'D', lineId: first }).state, 'trashed')
})

test('tags index every line and page title with a #tag, from the documents, newest day first', () => {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.save(dayId(yesterday), doc => under(doc, 'Notes', bullet('a', text('Idea #rewind keep the loop'))))
  h.save(dayId(today), doc => under(under(doc, 'Notes', bullet('b', text('#rewind again #cook'))), 'TODO', todo('t', 'Cook #cook dinner')))
  const index = tagIndex(h.ws)
  const rewind = index.find(e => e.tag === 'rewind')!, cook = index.find(e => e.tag === 'cook')!
  assert.equal(rewind.occurrences.length, 2)
  assert.equal(rewind.occurrences[0]!.pageId, dayId(today))
  assert.equal(cook.occurrences.length, 2)
  assert.ok(cook.occurrences.some(o => o.blockId === 't'))
})

test('export: Markdown per day and page with checkboxes and nesting; the JSON holds pages with their documents and tasks, nothing else', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-document', title: 'Soup', body: 'Recipe', pageId: 'R' })
  h.save(dayId(today), doc => under(under(doc, 'Notes', para('n', text('see '), pageRef('R', 'r1'))), 'TODO', todo('a', 'Parent', 'plan', today, [todo('b', 'Child')]), todo('c', 'Done one')))
  h.run({ type: 'task-status', taskId: h.task('Done one').id, status: 'done', today })
  const files = exportFiles(h.ws, new Date('2026-10-22T20:00:00Z'))
  const dayFile = files.find(f => f.path.endsWith(`days/${today}.md`))!
  assert.match(dayFile.text, /- \[ \] Parent\n\t- \[ \] Child\n- \[x\] Done one/)
  assert.match(dayFile.text, /\[\[Soup\]\]/)
  assert.ok(files.some(f => f.path.endsWith('pages/Soup.md')))
  const json = exportJson(h.ws, new Date('2026-10-22T20:00:00Z'))
  assert.equal(json.formatVersion, 2)
  assert.deepEqual(Object.keys(json).sort(), ['exportedAt', 'format', 'formatVersion', 'pages', 'revision', 'schemaVersion', 'tasks', 'timezone'])
  assert.equal(json.tasks.length, 3)
  assert.ok(Array.isArray(json.pages[0]!.document))
})

test('a future day is never created by reading; a plan on it creates it; the calendar lists planned and due tasks by day', async () => {
  const { getCalendarTasks } = await import('../src/domain/workspace.ts')
  const h = harness()
  h.day(today)
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Due tomorrow', plannedOn: today, deadlineOn: tomorrow })
  assert.deepEqual(getCalendarTasks(h.ws, tomorrow).map(t => t.title), ['Due tomorrow'])
  assert.ok(!h.ws.pages.some(p => p.id === dayId(tomorrow)))
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Go tomorrow', plannedOn: today })
  h.run({ type: 'plan-task', taskId: h.task('Go tomorrow').id, date: tomorrow, from: today, today })
  assert.deepEqual(getCalendarTasks(h.ws, tomorrow).map(t => t.title).sort(), ['Due tomorrow', 'Go tomorrow'])
  assert.ok(h.ws.pages.some(p => p.id === dayId(tomorrow)))
})
