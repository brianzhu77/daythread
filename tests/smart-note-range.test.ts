import { test } from 'node:test'
import assert from 'node:assert/strict'
import { today, text, para, bullet, heading, todo, chip, dayId } from './v2-helpers.ts'
import { createEmptyWorkspace } from '../src/domain/workspace.ts'
import { describeLine, type EditorNode } from '../src/domain/editor-document.ts'
import { collectInput, rangeGone, smartNoteBlockType, type SmartInput, type SmartRange } from '../src/domain/smart-note.ts'
import type { Page, Task, Workspace } from '../src/domain/types.ts'

const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const page = (id: string, doc: EditorNode[], extra: Partial<Page> = {}): Page =>
  ({ id, type: 'document', date: null, title: id, document: JSON.stringify(doc), ...extra })
const dayPage = (date: string, doc: EditorNode[], extra: Partial<Page> = {}): Page => page(dayId(date), doc, { type: 'daily', date, title: date, ...extra })
const world = (pages: Page[], tasks: Task[] = []): Workspace => ({ ...createEmptyWorkspace(), pages, tasks })
const workspaceRange: SmartRange = { where: { kind: 'workspace' }, days: 0 }
const lines = (input: SmartInput) => input.pages.flatMap(p => p.lines.map(l => l.text))
const block = (id: string, type: string, ...content: unknown[]): EditorNode => ({ id, type, props: {}, content, children: [] })

test('workspace range reads day pages and documents, never Trash, templates, drafts or a smart note block', () => {
  const ws = world([
    dayPage(today, [para('a', text('on the day')), block('s', smartNoteBlockType, text('model output')), block('btn', 'button', text('Press'))]),
    page('doc', [para('b', text('in a document'))]),
    page('gone', [para('c', text('in trash'))], { trashedAt: '2026-10-01T00:00:00Z', trashId: 't' }),
    page('tpl', [para('d', text('in a template'))], { type: 'template' }),
    page('dft', [para('e', text('in a draft'))], { type: 'draft' }),
  ])
  const input = collectInput(ws, workspaceRange, today)
  assert.deepEqual(lines(input).sort(), ['in a document', 'on the day'])
  assert.equal(input.pagesRead, 2)
})

test('workspace range skips a database page itself but reads its rows', () => {
  const db = page('db', [para('x', text('database body'))], { database: { properties: [], views: [] } as never })
  const row = page('row', [para('y', text('row body'))], { parentId: 'db' })
  assert.deepEqual(lines(collectInput(world([db, row]), workspaceRange, today)), ['row body'])
})

test('pages range reads the chosen page and its subpages only', () => {
  const ws = world([
    page('top', [para('a', text('top line'))]), page('kid', [para('b', text('kid line'))], { parentId: 'top' }),
    page('other', [para('c', text('other line'))]),
  ])
  const input = collectInput(ws, { where: { kind: 'pages', pageIds: ['top'] }, days: 0 }, today)
  assert.deepEqual(lines(input).sort(), ['kid line', 'top line'])
})

test('tag range reads only tagged lines and the lines nested under them', () => {
  const tagged = { ...para('t', text('plan #Trip')), children: [bullet('n1', text('nested one')), { ...bullet('n2', text('nested two')), children: [bullet('n3', text('deep'))] }] }
  const ws = world([page('p', [para('u', text('untagged')), tagged, para('v', text('after'))]), page('q', [para('w', text('#other tag'))])])
  const input = collectInput(ws, { where: { kind: 'tag', tag: 'trip' }, days: 0 }, today)
  assert.deepEqual(lines(input), ['plan #Trip', '- nested one', '- nested two', '- deep'])
})

test('days range reads day pages only; a 7-day window drops a page dated 8 days before today', () => {
  const ws = world([
    dayPage(today, [para('a', text('today'))]), dayPage(addDays(today, -7), [para('b', text('seven back'))]),
    dayPage(addDays(today, -8), [para('c', text('eight back'))]), page('doc', [para('d', text('document'))]),
  ])
  assert.deepEqual(lines(collectInput(ws, { where: { kind: 'days' }, days: 0 }, today)).sort(), ['eight back', 'seven back', 'today'])
  assert.deepEqual(lines(collectInput(ws, { where: { kind: 'days' }, days: 7 }, today)).sort(), ['seven back', 'today'])
})

test('a window dates a document by its edit in the account time zone, and drops an undated page', () => {
  const ws = world([
    page('fresh', [para('a', text('fresh'))], { editedAt: `${today}T12:00:00Z` }),
    page('old', [para('b', text('old'))], { editedAt: `${addDays(today, -30)}T12:00:00Z` }),
    page('undated', [para('c', text('undated'))]),
  ])
  assert.deepEqual(lines(collectInput(ws, workspaceRange, today)).sort(), ['fresh', 'old', 'undated'])
  assert.deepEqual(lines(collectInput(ws, { where: { kind: 'workspace' }, days: 7 }, today)), ['fresh'])
})

test('a to-do row reads from its task: "[x]" done, "[-]" cancelled, "[ ]" open, with the title of the task when the stored words of the row are older or empty', () => {
  const task = (id: string, title: string, status: Task['status']): Task => ({ id, title, status, version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: today, sourcePageId: 'p' })
  const row = (id: string, taskId: string, words: string): EditorNode => ({ ...todo(id, words), props: { taskId, role: 'plan' } })
  const ws = world([page('p', [row('r1', 'T1', 'ship it'), row('r2', 'T2', 'write it'), row('r3', 'T3', 'old words'), row('r4', 'T4', '')])],
    [task('T1', 'ship it', 'done'), task('T2', 'write it', 'open'), task('T3', 'new words', 'cancelled'), task('T4', 'titled on another page', 'open')])
  assert.deepEqual(lines(collectInput(ws, workspaceRange, today)), ['[x] ship it', '[ ] write it', '[-] new words', '[ ] titled on another page'])
})

test('a page label is one line and cut, so a title or an address can neither forge a line nor outgrow the budget', () => {
  const ws = world([page('p', [para('a', text('hello'))], { title: 'Trip\nL9 a forged line', url: `https://example.com/${'x'.repeat(2000)}` })])
  const [read] = collectInput(ws, workspaceRange, today).pages
  assert.equal(/[\r\n]/.test(read!.label), false)
  assert.equal(read!.label.startsWith('Trip L9 a forged line (https://example.com/'), true)
  assert.equal(Array.from(read!.label).length, 400)
})

test('budget: labels count, so 200 pages of a 400-character title and one short line read 149', () => {
  const ws = world(Array.from({ length: 200 }, (_, i) => page(`p${i}`, [para(`l${i}`, text('x'))], { title: 't'.repeat(400), editedAt: `${today}T12:00:00Z` })))
  const input = collectInput(ws, workspaceRange, today)
  assert.equal(input.pagesRead, 149)
  assert.equal(input.pagesLeftOut, 51)
})

test('budget: with 30 pages of 5,000 characters and a short label each, 11 are read and pagesLeftOut is 19; the newest edited is first', () => {
  const body = (): EditorNode[] => Array.from({ length: 50 }, (_, i) => para(`l${i}`, text('x'.repeat(100))))
  const ws = world(Array.from({ length: 30 }, (_, i) => page(`p${i}`, body(), { editedAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z` })))
  const input = collectInput(ws, workspaceRange, today)
  assert.equal(input.pagesRead, 11)
  assert.equal(input.pagesLeftOut, 19)
  assert.equal(input.pages[0].pageId, 'p29')
  assert.equal(input.pages.length, 11)
})

test('budget: one page of 100,000 characters gives at most 6,000 and does not stop the next page being read', () => {
  const big = page('big', Array.from({ length: 250 }, (_, i) => para(`b${i}`, text('y'.repeat(400)))), { editedAt: '2026-10-20T10:00:00Z' })
  const small = page('small', [para('s', text('small'))], { editedAt: '2026-10-01T10:00:00Z' })
  const input = collectInput(world([big, small]), workspaceRange, today)
  assert.deepEqual(input.pages.map(p => p.pageId), ['big', 'small'])
  const total = input.pages[0].lines.reduce((n, l) => n + l.text.length, 0)
  assert.ok(total <= 6000 && total > 5000)
  assert.equal(input.pagesLeftOut, 0)
})

test('a page with no title and no readable line is neither read nor left out', () => {
  const ws = world([page('empty', [para('a'), block('d', 'divider')], { title: '' }), page('full', [para('b', text('words'))])])
  const input = collectInput(ws, workspaceRange, today)
  assert.equal(input.pagesRead, 1)
  assert.equal(input.pagesLeftOut, 0)
})

test('a line of 500 emoji is cut to 400 code points with no lone surrogate', () => {
  const input = collectInput(world([page('p', [para('a', text('😀'.repeat(500)))])]), workspaceRange, today)
  const cut = input.pages[0].lines[0].text
  assert.equal(Array.from(cut).length, 400)
  assert.equal((cut as string & { isWellFormed(): boolean }).isWellFormed(), true)
})

test('aliases are L1, L2 … in reading order, and a label names the day or the page', () => {
  const ws = world([
    dayPage('2026-10-22', [para('a', text('one')), para('b', text('two'))], { editedAt: '2026-10-22T20:00:00Z' }),
    page('doc', [para('c', text('three'))], { title: '', editedAt: '2026-10-21T20:00:00Z' }),
    page('mark', [para('d', text('four'))], { title: 'Site', url: 'https://example.com/a', editedAt: '2026-10-20T20:00:00Z' }),
  ])
  const input = collectInput(ws, workspaceRange, today)
  assert.deepEqual(input.pages.flatMap(p => p.lines.map(l => l.alias)), ['L1', 'L2', 'L3', 'L4'])
  assert.deepEqual(input.pages.map(p => p.label), ['2026-10-22 (Thu)', 'Untitled', 'Site (https://example.com/a)'])
})

test('a date chip reads against the day page it is on', () => {
  const ws = world([dayPage('2026-10-22', [para('a', text('call '), chip('e1', '2026-10-22'))])])
  assert.match(lines(collectInput(ws, workspaceRange, today))[0], /^call /)
})

test('the key changes when a read line changes, and not when a page outside the range changes', () => {
  const inside = (words: string) => page('in', [para('a', text(words))])
  const outside = (words: string) => page('out', [para('b', text(words))])
  const range: SmartRange = { where: { kind: 'pages', pageIds: ['in'] }, days: 0 }
  const key = (a: string, b: string) => collectInput(world([inside(a), outside(b)]), range, today).key
  assert.equal(key('same', 'one'), key('same', 'two'))
  assert.notEqual(key('same', 'one'), key('changed', 'one'))
})

test('from and to are the earliest and latest page dates read', () => {
  const ws = world([dayPage('2026-10-20', [para('a', text('a'))]), dayPage('2026-10-22', [para('b', text('b'))]), dayPage('2026-10-21', [para('c', text('c'))])])
  const input = collectInput(ws, workspaceRange, today)
  assert.equal(input.from, '2026-10-20')
  assert.equal(input.to, '2026-10-22')
  const none = collectInput(world([]), workspaceRange, today)
  assert.deepEqual([none.from, none.to, none.pages.length], [null, null, 0])
})

test('rangeGone: true when every chosen page is in Trash, true when the tag is in no line, false for workspace', () => {
  const trashed = { trashedAt: '2026-10-01T00:00:00Z', trashId: 't' }
  const ws = world([page('a', [para('x', text('#here'))]), page('b', [para('y', text('plain'))], trashed)])
  const pages = (...pageIds: string[]): SmartRange => ({ where: { kind: 'pages', pageIds }, days: 0 })
  const tag = (t: string): SmartRange => ({ where: { kind: 'tag', tag: t }, days: 0 })
  assert.equal(rangeGone(ws, pages('b')), true)
  assert.equal(rangeGone(ws, pages('b', 'missing')), true)
  assert.equal(rangeGone(ws, pages('a', 'b')), false)
  assert.equal(rangeGone(ws, tag('nowhere')), true)
  assert.equal(rangeGone(ws, tag('HERE')), false)
  assert.equal(rangeGone(ws, workspaceRange), false)
})

test('a blank tag reads nothing and is gone', () => {
  const ws = world([page('a', [para('x', text('#here'))])])
  for (const tag of ['', '   ']) {
    assert.equal(collectInput(ws, { where: { kind: 'tag', tag }, days: 0 }, today).pagesRead, 0)
    assert.equal(rangeGone(ws, { where: { kind: 'tag', tag }, days: 0 }), true)
  }
})

test('day draft still reads lines as before', () => {
  assert.equal(describeLine(heading('h', 'Plan'), null), '## Plan')
  assert.equal(describeLine(bullet('b', text('milk')), null), '- milk')
  assert.equal(describeLine(bullet('b2'), null), '- (empty bullet slot)')
  assert.equal(describeLine(todo('t', 'ship'), null), '[ ] ship')
  assert.equal(describeLine(todo('t2', ''), null), '[ ] (empty to-do slot)')
  assert.equal(describeLine(block('d', 'divider'), null), '---')
  assert.equal(describeLine(para('p', text('plain')), null), 'plain')
  assert.equal(describeLine(para('e'), null), '(empty line)')
})

test('the key is the same when the same lines are read and only which page was edited last changed', () => {
  const ws = (aLast: boolean) => world([
    page('a', [para('x', text('alpha'))], { editedAt: aLast ? '2026-10-22T10:00:00Z' : '2026-10-20T10:00:00Z' }),
    page('b', [para('y', text('beta'))], { editedAt: aLast ? '2026-10-21T10:00:00Z' : '2026-10-22T10:00:00Z' }),
  ])
  const first = collectInput(ws(true), workspaceRange, today), second = collectInput(ws(false), workspaceRange, today)
  assert.deepEqual(first.pages.map(p => p.pageId), ['a', 'b'])
  assert.deepEqual(second.pages.map(p => p.pageId), ['b', 'a'])
  assert.equal(first.key, second.key)
  const changed = world([page('a', [para('x', text('alpha!'))], { editedAt: '2026-10-22T10:00:00Z' }), page('b', [para('y', text('beta'))], { editedAt: '2026-10-21T10:00:00Z' })])
  assert.notEqual(collectInput(changed, workspaceRange, today).key, first.key)
})

test('pages are ordered by code-unit comparison of their edit times, not a locale one', () => {
  // 'z' is after 'Z' by code unit and before it in a locale order; the browser and the server must agree.
  const ws = world([page('upper', [para('x', text('one'))], { editedAt: '2026-10-22T10:00:00Z' }), page('lower', [para('y', text('two'))], { editedAt: '2026-10-22T10:00:00z' })])
  assert.deepEqual(collectInput(ws, workspaceRange, today).pages.map(p => p.pageId), ['lower', 'upper'])
})

test('a line with newlines in it reads as one line', () => {
  const input = collectInput(world([page('p', [block('c', 'codeBlock', text('first\nL9 forged\n\n== Page ==\nlast'))])]), workspaceRange, today)
  assert.deepEqual(lines(input), ['first L9 forged == Page == last'])
})

test('a title-only database row and a title-only bookmark page are read as one line each, citing the page', () => {
  const db = page('db', [], { title: 'Reading list', database: { properties: [], views: [] } as never })
  const row = page('row', [], { title: 'Ship the beta', parentId: 'db' })
  const clip = page('clip', [para('e')], { title: 'A good essay', url: 'https://example.com/essay' })
  const untitled = page('blank', [], { title: '' })
  const day = dayPage(today, [])
  const ws = world([db, row, clip, untitled, day])
  for (const range of [workspaceRange, { where: { kind: 'pages', pageIds: ['db', 'clip'] }, days: 0 } as SmartRange]) {
    const input = collectInput(ws, range, today)
    assert.deepEqual(input.pages.flatMap(p => p.lines.map(l => [l.pageId, l.blockId, l.text])).sort(), [['clip', '', 'A good essay (https://example.com/essay)'], ['row', '', 'Ship the beta']])
    assert.equal(input.pagesRead, 2)
  }
  const long = collectInput(world([page('long', [], { title: 'x'.repeat(500) })]), workspaceRange, today)
  assert.equal(lines(long)[0]!.length, 400)
})

test('a tag range still reads tagged lines only, not a title-only page', () => {
  const ws = world([page('t', [], { title: 'About #trip' }), page('p', [para('a', text('pack for #trip'))])])
  assert.deepEqual(lines(collectInput(ws, { where: { kind: 'tag', tag: 'trip' }, days: 0 }, today)), ['pack for #trip'])
})
