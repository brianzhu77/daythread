import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView } from '../src/domain/workspace.ts'
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
