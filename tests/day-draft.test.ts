import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, text, todo, bullet, para, heading, nodesOf, under } from './v2-helpers.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'
import { draftOf, draftPageId, draftView, moreOpenAfterIndex, planningEndIndex, planningRange, type DraftItem } from '../src/domain/day-draft.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { childPages, visiblePages } from '../src/domain/page-tree.ts'
import { buildSearchIndex } from '../src/domain/search.ts'
import { exportFiles } from '../src/domain/export.ts'

// B77: a day draft. The shape of his newest template, in neutral words: a planning section with sub-sections and
// to-do slots, then a reflection section.
const level = (n: EditorNode, l: number): EditorNode => ({ ...n, props: { level: l } })
const quote = (id: string, words: string): EditorNode => ({ id, type: 'quote', props: {}, content: [text(words)], children: [] })
const template = (): EditorNode[] => [
  heading('m', 'Morning'), level(heading('ev', 'Events'), 3), bullet('eb'),
  level(heading('t3', 'Top 3'), 3), quote('q', 'Finishable today.'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', ''), todo('s3', '', 'reference', ''),
  level(heading('o', 'Other'), 3), todo('s4', '', 'reference', ''),
  heading('r', 'Reflection'), level(heading('pr', 'Progress'), 4), para('pp', text('What went well?')), para('blank'),
]
const shape = (nodes: EditorNode[]) => nodes.map(n => `${n.type}:${inlineText(n.content).trim()}`)

/** Yesterday with two open to-dos; tomorrow made from the template; returns the harness and tomorrow's block ids by template position. */
function setup() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => template())
  const day = h.day(tomorrow)
  const ids = nodesOf(day).map(n => n.id)
  const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
  const draft = (items: Partial<DraftItem>[], moreOpen: string[] = []) => h.run({
    type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen, allowedTaskIds: [book, dog],
    items: items.map((x, i) => ({ id: `i${i}`, anchor: ids[5]!, place: 'fill', source: 'model', state: 'open', ...x }) as DraftItem),
  })
  return { h, ids, book, dog, draft, page: () => h.page(dayId(tomorrow)) }
}

test('draft: the planning part is the outermost section holding the first to-do row, never the reflection', () => {
  const { page } = setup()
  const doc = nodesOf(page())
  const { start, end } = planningRange(doc)
  assert.equal(inlineText(doc[start]!.content), 'Morning')
  assert.equal(inlineText(doc[end]!.content), 'Reflection')
})

test('draft: "more open" goes at the end of the planning part, before a closing divider, never under the heading', () => {
  const at = (doc: EditorNode[]) => { const i = moreOpenAfterIndex(doc, planningEndIndex(doc, new Set())); return i < 0 ? null : doc[i]!.id }
  const divider = (id: string): EditorNode => ({ id, type: 'divider', props: {}, children: [] })
  // His layout: planning sub-sections, an empty line, then `---` above the reflection.
  assert.equal(at([...template().slice(0, 10), level(heading('d', 'Drop'), 3), para('dl'), divider('hr'), ...template().slice(10)]), 'dl')
  // The built-in day: after the TODO slot, not between the heading and it.
  assert.equal(at([heading('t', 'TODO'), todo('slot', '', 'reference', ''), heading('e', 'Events'), bullet('b')]), 'slot')
  // A planning part that is only its heading.
  assert.equal(at([heading('p', 'Plan'), heading('n', 'Notes'), para('x', text('words'))]), 'p')
  // No headings: after the last to-do row, not below his notes; with no rows, where the fallback bands go (the top).
  assert.equal(at([todo('a', 'One', 'plan'), bullet('b', text('note')), todo('c', 'Two', 'plan'), para('n', text('long notes'))]), 'c')
  assert.equal(at([para('n', text('notes')), bullet('b', text('more'))]), null)
})

test('draft: stored as a hidden page under the day; never a page, a subpage, a search hit or an export file', () => {
  const { h, draft, book } = setup()
  draft([{ taskId: book }])
  const p = h.ws.pages.find(x => x.id === draftPageId(dayId(tomorrow)))!
  assert.equal(p.type, 'draft')
  assert.equal(p.parentId, dayId(tomorrow))
  assert.ok(!visiblePages(h.ws).some(x => x.id === p.id))
  assert.ok(!childPages(h.ws, dayId(tomorrow)).some(x => x.id === p.id))
  assert.ok(!buildSearchIndex(h.ws).pages.some(x => x.page.id === p.id))
  const files = exportFiles(h.ws, new Date('2026-10-23T12:00:00Z'))
  assert.ok(files.length > 0 && !files.some(f => f.path.includes('draft') || f.text.includes('"items"')))
  assert.throws(() => h.run({ type: 'rename-page', pageId: p.id, title: 'x' }), /Not a page/)
})

test('draft: the view shows each open item where it goes, with the task under its current title', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }], [])
  const t = h.task('Book the flights')
  t.title = 'Book the flights to Lisbon'
  const view = draftView(h.ws, page())!
  assert.deepEqual(view.items.map(i => [i.kind, i.anchorId, inlineText(i.block.content)]), [['fill', ids[5], 'Book the flights to Lisbon'], ['fill', ids[6], 'Buy a dog bed']])
})

test('draft: Apply fills the slots with the same tasks, planned for the day, in one operation that one Undo reverts', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }])
  const before = shape(nodesOf(page())), tasks = h.ws.tasks.length
  const r = h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], today: tomorrow })
  assert.equal(r.receipt.message, 'Applied 2')
  const after = shape(nodesOf(page()))
  assert.deepEqual(after.slice(3, 8), ['heading:Top 3', 'quote:Finishable today.', 'task:Book the flights', 'task:Buy a dog bed', 'task:'])
  assert.equal(h.ws.tasks.length, tasks, 'no new task: the same ones')
  assert.equal(plannedOn(h.ws, book), tomorrow)
  assert.deepEqual(draftView(h.ws, page())!.items, [])
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(shape(nodesOf(page())), before)
  assert.equal(draftView(h.ws, page())!.items.length, 2, 'the bands come back with the rows')
})

test('draft: partial Apply then Apply all never applies an item twice', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }])
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0'], today: tomorrow })
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], today: tomorrow })
  assert.throws(() => h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], today: tomorrow }), /Nothing to apply/)
  assert.equal(shape(nodesOf(page())).filter(s => s === 'task:Book the flights').length, 1)
})

test('draft: a to-do done, cancelled or set aside elsewhere drops out; a renamed one stays and keeps its new title', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }])
  h.run({ type: 'task-status', taskId: book, status: 'done', today: tomorrow })
  h.task('Buy a dog bed').title = 'Buy a big dog bed'
  assert.deepEqual(draftView(h.ws, page())!.items.map(i => i.taskId), [dog])
  const r = h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], today: tomorrow })
  assert.equal(r.receipt.message, 'Applied')
  assert.ok(shape(nodesOf(page())).includes('task:Buy a big dog bed'))
  assert.ok(!shape(nodesOf(page())).includes('task:Book the flights'))
})

test('draft: a fill whose slot he already wrote in goes after it; a gone anchor goes to the planning end', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: 'gone' }])
  h.save(dayId(tomorrow), d => d.map(n => (n.id === ids[5] ? { ...n, content: [text('Write the intro')] } : n)))
  const view = draftView(h.ws, page())!
  assert.deepEqual(view.items.map(i => i.kind), ['after', 'after'])
  assert.equal(view.items[1]!.anchorId, ids[0], 'right under the planning heading')
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], today: tomorrow })
  const after = shape(nodesOf(page()))
  assert.deepEqual(after.slice(0, 2), ['heading:Morning', 'task:Buy a dog bed'])
  assert.equal(after[after.indexOf('task:Write the intro') + 1], 'task:Book the flights')
})

test('draft: no line anchored in the reflection is kept, and only allowed tasks are', () => {
  const { h, ids, book, draft } = setup()
  draft([{ taskId: book, anchor: ids[12]! }, { taskId: 'someone-else', anchor: ids[5]! }, { anchor: ids[5]!, place: 'after', block: { id: 'b', type: 'paragraph', props: {}, content: [text('Stretch')], children: [] } }])
  assert.deepEqual(draftOf(h.ws, dayId(tomorrow))!.items.map(i => i.block ? inlineText(i.block.content) : [i.taskId, i.anchor]), [[book, ''], 'Stretch'], 'the to-do moves to the planning end; the line in the reflection goes')
})

test('draft: a new to-do is a new task; a new line is a line; edits change their words', () => {
  const { h, ids, draft, page } = setup()
  draft([
    { anchor: ids[7]!, block: { id: 'n1', type: 'task', props: {}, content: [text('Call the vet')], children: [] } },
    { anchor: ids[2]!, block: { id: 'n2', type: 'bulletListItem', props: {}, content: [text('Lunch with Sam')], children: [] } },
  ])
  const tasks = h.ws.tasks.length
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0', 'i1'], edits: { i0: 'Call the vet at 9' }, today: tomorrow })
  assert.equal(h.ws.tasks.length, tasks + 1)
  assert.equal(plannedOn(h.ws, h.task('Call the vet at 9').id), tomorrow)
  assert.ok(shape(nodesOf(page())).includes('bulletListItem:Lunch with Sam'))
})

test('draft: Skip leaves the task alone, and a late answer never brings back what he applied or skipped', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }])
  h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: ['i0'] })
  assert.equal(h.task('Book the flights').status, 'open')
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i1'], today: tomorrow })
  assert.throws(() => draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[6]! }]), /already has its draft/)
  assert.deepEqual(draftView(h.ws, page())!.items, [])
})

test('draft: "more open" lists the open to-dos it holds, minus any now on the page or closed', () => {
  const { h, book, dog, draft, page } = setup()
  draft([], [book, dog])
  h.run({ type: 'task-status', taskId: dog, status: 'cancelled' })
  assert.deepEqual(draftView(h.ws, page())!.moreOpen.map(m => m.title), ['Book the flights'])
})

test('draft: no page command reaches it: rename, move, delete, save, or a page inside it', () => {
  const { h, draft, book } = setup()
  draft([{ taskId: book }])
  const id = draftPageId(dayId(tomorrow))
  assert.throws(() => h.run({ type: 'rename-page', pageId: id, title: 'x' }), /Not a page|not found/)
  assert.throws(() => h.run({ type: 'move-page', pageId: id, parentId: null }), /not found/)
  assert.throws(() => h.run({ type: 'delete-page', pageId: id, at: 'x' }), /Not a page|not found/)
  assert.throws(() => h.run({ type: 'save-editor', pageId: id, expectedContent: '', document: '[]' }), /Not a page|not found/)
  assert.throws(() => h.run({ type: 'create-document', title: 'x', body: '', parentId: id }), /Not a page|not found/)
})

test('draft: after a fill, the bands anchored on that slot stay right after the filled row', () => {
  const { h, ids, book, dog, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[5]! }, { taskId: dog, anchor: ids[5]!, place: 'after' }])
  h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0'], today: tomorrow })
  const view = draftView(h.ws, page())!
  assert.deepEqual(view.items.map(i => [i.taskId, i.kind, i.anchorId]), [[dog, 'after', ids[5]]])
})

test('draft: the first ready draft wins; a late answer or a second tab never replaces it', () => {
  const { h, book, dog, draft, page } = setup()
  draft([{ taskId: book }])
  assert.throws(() => draft([{ taskId: dog }]), /already has its draft/)
  assert.deepEqual(draftView(h.ws, page())!.items.map(i => i.taskId), [book])
})

test('draft: a carried to-do whose anchor left the planning part goes to the planning end, never lost', () => {
  const { h, ids, book, draft, page } = setup()
  draft([{ taskId: book, anchor: ids[12]! }])
  const view = draftView(h.ws, page())!
  assert.deepEqual(view.items.map(i => [i.taskId, i.kind, i.anchorId]), [[book, 'after', ids[0]]])
})

test('draft: a failed draft can be retried until his first Apply or Skip, then it is the day\'s draft', () => {
  const { h, book, dog, page } = setup()
  const set = (taskId: string, status: 'ready' | 'failed') => h.run({ type: 'set-draft', pageId: dayId(tomorrow), status, items: [{ id: `x-${taskId}-${status}`, anchor: '', place: 'after', taskId, source: 'fallback', state: 'open' }], moreOpen: [], allowedTaskIds: [book, dog] })
  set(book, 'failed')
  assert.equal(draftView(h.ws, page())!.status, 'failed')
  set(dog, 'failed')
  assert.deepEqual(draftView(h.ws, page())!.items.map(i => i.taskId), [dog], 'a retry before any choice replaces the fallback bands')
  h.run({ type: 'skip-draft', pageId: dayId(tomorrow), itemIds: [`x-${dog}-failed`] })
  assert.equal(draftView(h.ws, page())!.status, 'ready', 'after a choice, no more Retry')
  assert.throws(() => set(book, 'ready'), /already has its draft/)
})
