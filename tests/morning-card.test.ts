import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getCalendarTasks, getDayView } from '../src/domain/workspace.ts'
import { getUpcomingByDate } from '../src/domain/upcoming.ts'
import { editorSeed, inlineText, needsTemplateRows, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { tagIndex } from '../src/domain/tags.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// Morning card (docs/design/morning-card-build.md §5): Bring to today copies a line from the previous day.
const run = (ws: Workspace, action: Action) => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action) => run(ws, action).workspace
const day = (ws: Workspace, date: string) => ws.pages.find(p => p.date === date)!
const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const line = (id: string, t: string, type = 'bulletListItem'): EditorNode => ({ id, type, content: text(t) })
const link = (id: string, url: string, title: string): EditorNode => ({ id, type: 'bulletListItem', content: [{ type: 'link', href: url, content: text(title) }] })
const heading = (id: string, t: string): EditorNode => ({ id, type: 'heading', props: { level: 2 }, content: t })
function edit(ws: Workspace, date: string, change: (doc: EditorNode[]) => EditorNode[]) {
  const p = day(ws, date)
  return ok(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(change(editorSeed(p, ws, { templateRows: needsTemplateRows(p, date) }))), today: date })
}
/** Sun Oct 18 with Notes lines, a Good Stuffs link and a custom "Reading" section; Mon Oct 19 exists, never opened. */
function yesterday() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  ws = edit(ws, '2026-10-18', doc => {
    const at = (title: string) => doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === title)
    const out = [...doc]
    out.splice(at('Notes') + 1, 0, line('n1', 'call mom #family'), line('n2', 'idea: pickle ramen'))
    out.splice(at('Good Stuffs') + 1, 0, link('g1', 'https://example.com/essay', 'Calm tech essay'))
    return [...out, heading('h-reading', 'Reading'), line('r1', 'finish chapter 3')]
  })
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-19' })
  return ws
}
const sectionOf = (ws: Workspace, date: string, blockId: string) => day(ws, date).sections.find(s => s.blocks.some(b => b.id === blockId))!
const bring = (ws: Workspace, sourceBlockId: string) => run(ws, { type: 'bring-line', date: '2026-10-19', sourcePageId: day(ws, '2026-10-18').id, sourceBlockId })

test('a Notes line is copied into today\'s Notes, keeps its source, and is not offered again', () => {
  let ws = yesterday()
  const offered = () => getDayView(ws, '2026-10-19').handoffBlocks.map(h => h.block.id)
  assert.deepEqual(offered().filter(id => ['n1', 'n2', 'g1'].includes(id)), ['g1', 'n1', 'n2'])
  const source = structuredClone(day(ws, '2026-10-18'))
  const r = bring(ws, 'n1'); ws = r.workspace
  const copy = day(ws, '2026-10-19').sections.flatMap(s => s.blocks).find(b => b.id === r.receipt.entityId)!
  assert.equal(copy.text, 'call mom #family')
  assert.equal(copy.sourcePageId, source.id); assert.equal(copy.sourceBlockId, 'n1')
  assert.equal(sectionOf(ws, '2026-10-19', copy.id).title, 'Notes')
  assert.equal(r.receipt.message, 'Brought to Notes')
  assert.equal(offered().includes('n1'), false)
  assert.deepEqual(day(ws, '2026-10-18'), source, 'the source line and page are unchanged')
  assert.throws(() => bring(ws, 'n1'), /Already brought/)
})

test('the copy goes through the editor save path: tags, starter rows and the editor document all agree', () => {
  let ws = yesterday()
  ws = bring(ws, 'n1').workspace
  const today = day(ws, '2026-10-19')
  assert.ok(tagIndex(ws).find(t => t.key === 'family')!.occurrences.some(o => o.pageId === today.id))
  // Today's page had never been opened: its starter rows are saved with it, not lost.
  const doc = JSON.parse(today.editorJSON!) as EditorNode[]
  assert.ok(doc.some(n => n.type === 'task' && String(n.props?.taskId).startsWith('editor-task:')), 'the empty Top 3 row is still there')
  assert.equal(today.templateApplied, true)
  // The copy sits after the section's text and before its empty starter row.
  const notes = doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes')
  assert.equal(inlineText(doc[notes + 1]!.content), 'call mom #family')
  assert.equal(doc[notes + 2]!.type, 'bulletListItem'); assert.equal(inlineText(doc[notes + 2]!.content), '')
  assert.deepEqual(editorSeed(today, ws).map(n => n.id), doc.map(n => n.id))
})

test('a Good Stuffs link brought to today is another save of the same material', () => {
  let ws = yesterday()
  const material = ws.materials.find(m => m.url === 'https://example.com/essay')!
  ws = bring(ws, 'g1').workspace
  const copy = day(ws, '2026-10-19').sections.flatMap(s => s.blocks).find(b => b.sourceBlockId === 'g1')!
  assert.equal(sectionOf(ws, '2026-10-19', copy.id).title, 'Good Stuffs')
  assert.equal(copy.kind, 'material'); assert.equal(copy.materialId, material.id)
  assert.equal(ws.materials.length, 1)
  assert.deepEqual(ws.materials[0]!.sources.map(s => s.blockId), ['g1', copy.id])
})

test('a line goes to the same-named section, or to Notes when today has none', () => {
  let ws = yesterday()
  ws = bring(ws, 'r1').workspace
  const copy = day(ws, '2026-10-19').sections.flatMap(s => s.blocks).find(b => b.sourceBlockId === 'r1')!
  assert.equal(sectionOf(ws, '2026-10-19', copy.id).title, 'Notes', 'today has no Reading section')
  ws = bring(ws, 'g1').workspace
  assert.equal(sectionOf(ws, '2026-10-19', day(ws, '2026-10-19').sections.flatMap(s => s.blocks).find(b => b.sourceBlockId === 'g1')!.id).title, 'Good Stuffs')
})

test('the same-named section is matched case-insensitively', () => {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  ws = edit(ws, '2026-10-18', doc => [...doc, heading('h-r', 'Reading'), line('r1', 'finish chapter 3')])
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-19' })
  ws = edit(ws, '2026-10-19', doc => [...doc, heading('h-r2', 'reading')])
  ws = bring(ws, 'r1').workspace
  const copy = day(ws, '2026-10-19').sections.flatMap(s => s.blocks).find(b => b.sourceBlockId === 'r1')!
  assert.equal(sectionOf(ws, '2026-10-19', copy.id).title, 'reading')
})

test('with no Notes section at all, a Notes heading is added at the end', () => {
  let ws = yesterday()
  ws = edit(ws, '2026-10-19', doc => doc.filter(n => !(n.type === 'heading' && inlineText(n.content) === 'Notes')))
  ws = bring(ws, 'n2').workspace
  const today = day(ws, '2026-10-19')
  assert.equal(today.sections.at(-1)!.title, 'Notes')
  assert.equal(today.sections.at(-1)!.blocks.at(-1)!.sourceBlockId, 'n2')
})

test('tasks, page cards, empty lines and unknown lines are refused and write nothing', () => {
  let ws = yesterday()
  ws = ok(ws, { type: 'create-document', title: 'Recipe', body: '', pageId: 'recipe', parentId: day(ws, '2026-10-18').id })
  ws = edit(ws, '2026-10-18', doc => [...doc, { id: 'card', type: 'pageLink', props: { pageId: 'recipe' } }, line('blank', '')])
  const before = JSON.stringify(ws)
  assert.throws(() => bring(ws, 'card'), /Only text lines/)
  assert.throws(() => bring(ws, 'blank'), /Only text lines/)
  assert.throws(() => bring(ws, 'missing'), /Line not found/)
  assert.throws(() => run(ws, { type: 'bring-line', date: '2026-10-25', sourcePageId: day(ws, '2026-10-18').id, sourceBlockId: 'n1' }), /Page not found/)
  assert.equal(JSON.stringify(ws), before)
})

test('Undo removes the copy and offers the line again', () => {
  let ws = yesterday()
  const before = structuredClone(day(ws, '2026-10-19'))
  const r = bring(ws, 'n1')
  ws = ok(r.workspace, { type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(day(ws, '2026-10-19'), before)
  assert.ok(getDayView(ws, '2026-10-19').handoffBlocks.some(h => h.block.id === 'n1'))
})

test('the browser command schema accepts bring-line', () => {
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'bring-line', date: '2026-10-19', sourcePageId: 'p', sourceBlockId: 'b' } }).success)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'bring-line', date: 'today', sourcePageId: 'p', sourceBlockId: 'b' } }).success, false)
})

test('a copy deleted later is not offered again; event and page-card lines are never offered', () => {
  let ws = yesterday()
  ws = ok(ws, { type: 'create-document', title: 'Recipe', body: '', pageId: 'recipe', parentId: day(ws, '2026-10-18').id })
  ws = edit(ws, '2026-10-18', doc => [...doc.slice(0, doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes') + 1), { id: 'card', type: 'pageLink', props: { pageId: 'recipe' } }, ...doc.slice(doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes') + 1)])
  const offered = () => getDayView(ws, '2026-10-19').handoffBlocks.map(h => h.block.id)
  assert.equal(offered().includes('card'), false)
  const r = bring(ws, 'n1'); ws = r.workspace
  ws = edit(ws, '2026-10-19', doc => doc.filter(n => n.id !== r.receipt.entityId))
  assert.equal(day(ws, '2026-10-19').sections.some(s => s.blocks.some(b => b.sourceBlockId === 'n1')), false, 'the copy is gone')
  assert.equal(offered().includes('n1'), false)
  assert.throws(() => bring(ws, 'n1'), /Already brought/)
})

// Tasks group (§3, §6): Add all is one operation; a full Top 3 sends the rest to the plan list.
function withTasks(n: number) {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  const p = day(ws, '2026-10-19')
  for (let i = 0; i < n; i++) ws = ok(ws, { type: 'add-task', pageId: p.id, sectionId: p.sections.find(s => s.kind === 'notes')!.id, title: `t${i}` } as Action)
  return ws
}
const planned = (ws: Workspace, kind: 'top3' | 'other') => day(ws, '2026-10-19').sections.filter(s => s.kind === kind).flatMap(s => s.blocks).filter(b => b.kind === 'task').map(b => ws.tasks.find(t => t.id === b.taskId)!.title)

test('Add all tasks plans every row in one operation; one Undo takes them all back', () => {
  let ws = withTasks(3)
  const [a, b, c] = ws.tasks
  const before = structuredClone(ws)
  const r = run(ws, { type: 'plan-tasks', date: '2026-10-19', items: [{ taskId: a!.id, section: 'top3' }, { taskId: b!.id, section: 'other' }, { taskId: c!.id, section: 'top3' }] })
  ws = r.workspace
  assert.deepEqual(planned(ws, 'top3'), ['t0', 't2']); assert.deepEqual(planned(ws, 'other'), ['t1'])
  ws = ok(ws, { type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(ws.tasks, before.tasks); assert.deepEqual(ws.placements, before.placements); assert.deepEqual(day(ws, '2026-10-19').sections, day(before, '2026-10-19').sections)
  assert.throws(() => run(ws, { type: 'plan-tasks', date: '2026-10-19', items: [{ taskId: a!.id, section: 'top3' }, { taskId: a!.id, section: 'other' }] }), /twice/)
})

test('with Top 3 full, the next Top 3 row goes to the plan list', () => {
  let ws = withTasks(5)
  ws = ok(ws, { type: 'plan-tasks', date: '2026-10-19', items: ws.tasks.map(t => ({ taskId: t.id, section: 'top3' as const })) })
  assert.deepEqual(planned(ws, 'top3'), ['t0', 't1', 't2']); assert.deepEqual(planned(ws, 'other'), ['t3', 't4'])
})

test('a removed plan section comes back at the top, in template order', () => {
  let ws = withTasks(2)
  ws = edit(ws, '2026-10-19', doc => {
    const drop = new Set(day(ws, '2026-10-19').sections.filter(s => s.kind === 'top3' || s.kind === 'other').map(s => s.id))
    return doc.filter(n => !drop.has(n.id) && !(n.type === 'task' && String(n.props?.taskId).startsWith('editor-task:')))
  })
  assert.equal(day(ws, '2026-10-19').sections.some(s => s.kind === 'top3' || s.kind === 'other'), false)
  ws = ok(ws, { type: 'plan-task', taskId: ws.tasks[0]!.id, date: '2026-10-19', section: 'other' })
  ws = ok(ws, { type: 'plan-task', taskId: ws.tasks[1]!.id, date: '2026-10-19', section: 'top3' })
  assert.deepEqual(day(ws, '2026-10-19').sections.slice(0, 2).map(s => s.kind), ['top3', 'other'])
})

// Ratchet #75: Top 3 has two tasks; he types a third into its empty row and taps + on a suggestion right away. The
// editor's save lands first, so the server sees a full Top 3 and sends the suggestion to the plan list.
test('a + after typing the third Top 3 row goes to the plan list; Top 3 stays at three', () => {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  const top3Id = day(ws, '2026-10-19').sections.find(s => s.kind === 'top3')!.id
  const row = (id: string, title: string): EditorNode => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: '2026-10-19' }, content: title })
  ws = edit(ws, '2026-10-19', doc => { const at = doc.findIndex(n => n.id === top3Id); return [...doc.slice(0, at + 1), row('a', 'one'), row('b', 'two'), ...doc.slice(at + 1)] })
  const p = day(ws, '2026-10-19')
  ws = ok(ws, { type: 'add-task', pageId: p.id, sectionId: p.sections.find(s => s.kind === 'notes')!.id, title: 'suggested' } as Action)
  const suggested = ws.tasks.find(t => t.title === 'suggested')!
  // The save of the typed third row, then the card's command.
  ws = edit(ws, '2026-10-19', doc => doc.map(n => n.type === 'task' && n.id.includes(':top3:template:') ? { ...n, content: 'three' } : n))
  assert.deepEqual(planned(ws, 'top3'), ['one', 'two', 'three'])
  ws = ok(ws, { type: 'plan-tasks', date: '2026-10-19', items: [{ taskId: suggested.id, section: 'top3' }] })
  assert.deepEqual(planned(ws, 'top3'), ['one', 'two', 'three'])
  assert.deepEqual(planned(ws, 'other'), ['suggested'])
})

test('planned tasks go before the section\'s empty starter row, from the card and from plan-task alike', () => {
  // Two tasks made on Sunday, then today's page opened once so its starter rows are saved, as on Brian's page.
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  const sun = day(ws, '2026-10-18')
  for (const title of ['t0', 't1']) ws = ok(ws, { type: 'add-task', pageId: sun.id, sectionId: sun.sections.find(s => s.kind === 'notes')!.id, title } as Action)
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-19' })
  ws = edit(ws, '2026-10-19', doc => doc)
  const order = (kind: 'top3' | 'other') => {
    const s = day(ws, '2026-10-19').sections.find(x => x.kind === kind)!
    return s.blocks.map(b => ws.tasks.find(t => t.id === b.taskId)?.title ?? (b.text || '∅'))
  }
  assert.deepEqual(order('other'), ['∅'])
  ws = ok(ws, { type: 'plan-tasks', date: '2026-10-19', items: [{ taskId: ws.tasks[0]!.id, section: 'other' }] })
  ws = ok(ws, { type: 'plan-task', taskId: ws.tasks[1]!.id, date: '2026-10-19', section: 'top3' })
  assert.deepEqual(order('other'), ['t0', '∅'])
  assert.deepEqual(order('top3'), ['t1', '∅'])
  // The editor document shows the same order.
  const doc = editorSeed(day(ws, '2026-10-19'), ws).map(n => n.type === 'heading' ? `#${inlineText(n.content)}` : inlineText(n.content) || '∅')
  assert.deepEqual(doc.slice(0, 6), ['#TODO - Top 3', 't1', '∅', '#TODO - Other', 't0', '∅'])
})

test('the stored shape on Brian\'s page (a starter task row saved as an empty draft task) also stays last', () => {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  const sun = day(ws, '2026-10-18')
  ws = ok(ws, { type: 'add-task', pageId: sun.id, sectionId: sun.sections.find(s => s.kind === 'notes')!.id, title: 'Water plants' } as Action)
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-19' })
  ws = edit(ws, '2026-10-19', doc => doc)
  // As read from his database: { kind: 'task', taskId: 'editor-task:<id>', text: '' } in TODO - Other.
  const other = day(ws, '2026-10-19').sections.find(s => s.kind === 'other')!
  other.blocks = other.blocks.map(b => b.text ? b : { id: b.id, kind: 'task', taskId: `editor-task:${b.id}`, text: '', planRole: 'plan' })
  ws = ok(ws, { type: 'plan-tasks', date: '2026-10-19', items: [{ taskId: ws.tasks.find(t => t.title === 'Water plants')!.id, section: 'other' }] })
  assert.deepEqual(day(ws, '2026-10-19').sections.find(s => s.kind === 'other')!.blocks.map(b => b.text || '∅'), ['Water plants', '∅'])
})

// Lead 2f917190 / d5723121: Brian's Oct 19 TODO - Other holds an open task with an empty title, placed on that day. No
// task list or count shows it; the page keeps its row; a title makes it a normal task again.
test('a task with an empty title is in no task list or count, stays on its page, and comes back once it has a title', () => {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  const mon = day(ws, '2026-10-19')
  for (const title of ['real task', 'blank']) ws = ok(ws, { type: 'add-task', pageId: mon.id, sectionId: mon.sections.find(s => s.kind === 'notes')!.id, title } as Action)
  for (const t of ws.tasks) ws = ok(ws, { type: 'plan-task', taskId: t.id, date: '2026-10-19', section: 'other' } as Action)
  const blankId = ws.tasks.find(t => t.title === 'blank')!.id
  // The stored shape on his page: same task, title emptied (whitespace counts as empty), due Oct 22 as well.
  ws = { ...ws, tasks: ws.tasks.map(t => t.id === blankId ? { ...t, title: '  ', deadlineOn: '2026-10-22' } : t) }
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-20' })
  const titles = (list: { title: string }[]) => list.map(t => t.title)
  let view = getDayView(ws, '2026-10-20')
  assert.deepEqual(titles(view.handoffTasks), ['real task'])
  assert.deepEqual(titles(view.openPool), ['real task'])
  assert.deepEqual(titles(getDayView(ws, '2026-10-19').planned), ['real task'])
  assert.deepEqual(titles(getCalendarTasks(ws, '2026-10-22')), [])
  assert.deepEqual(getUpcomingByDate(ws, '2026-10-20').flatMap(d => d.tasks.map(r => r.task.id)), [])
  assert.ok(day(ws, '2026-10-19').sections.some(s => s.blocks.some(b => b.taskId === blankId)), 'its row stays on the page')
  ws = ok(ws, { type: 'generate-draft', date: '2026-10-20' } as Action)
  assert.equal((day(ws, '2026-10-20').draft?.taskIds ?? []).includes(blankId), false)
  // Typing a title: it shows everywhere again.
  ws = { ...ws, tasks: ws.tasks.map(t => t.id === blankId ? { ...t, title: 'named now' } : t) }
  view = getDayView(ws, '2026-10-20')
  assert.deepEqual(titles(view.handoffTasks), ['real task', 'named now'])
  assert.deepEqual(titles(getCalendarTasks(ws, '2026-10-22')), ['named now'])
})
