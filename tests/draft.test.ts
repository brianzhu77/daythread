import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { checkedDate, draftLines, fingerprintOf, isLineLinked, liveProposal, resolveLineDate } from '../src/domain/draft.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action, DraftProposal, ServerAction, Workspace } from '../src/domain/types.ts'

// A6b step 1 (docs/plan/a6b-model-step2.md §4–§6): what the app decides around Draft my day.
const run = (ws: Workspace, action: Action | ServerAction, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action | ServerAction, operationId?: string) => run(ws, action, operationId).workspace
const day = (ws: Workspace, date: string) => ws.pages.find(p => p.date === date)!
const line = (id: string, text: string): EditorNode => ({ id, type: 'paragraph', content: text })
function edit(ws: Workspace, pageId: string, change: (doc: EditorNode[]) => EditorNode[]) {
  const p = ws.pages.find(x => x.id === pageId)!
  return ok(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(change(editorSeed(p, ws))) })
}
const atNotes = (doc: EditorNode[], ...add: EditorNode[]) => { const i = doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes'); return [...doc.slice(0, i + 1), ...add, ...doc.slice(i + 1)] }

/** Sun Oct 18 with two Notes lines and a subpage "Trip" holding "明天订酒店"; Mon Oct 19 open. */
function world() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  const sun = day(ws, '2026-10-18').id
  ws = edit(ws, sun, doc => atNotes(doc, line('n1', '周一给 Kevin 回电话'), line('n2', '奥德赛')))
  ws = ok(ws, { type: 'create-document', title: 'Trip', body: '', pageId: 'trip', parentId: sun })
  ws = edit(ws, 'trip', doc => [...doc, line('t1', '明天订酒店')])
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-19' })
  return { ws, sun }
}
const manifestFor = (ws: Workspace, ids: string[]) => {
  const lines = ids.map(lineId => {
    const [pageId, blockId] = lineId.split('/') as [string, string]
    const page = ws.pages.find(p => p.id === pageId)!, block = page.sections.flatMap(s => s.blocks).find(b => b.id === blockId)!
    return { lineId, pageId, blockId, fingerprint: fingerprintOf(ws, page, block) }
  })
  return { lines, sentPages: [], omittedPages: [], taskCandidates: ws.tasks.map(t => t.id), materialCandidates: [] }
}
/** A real run that proposed these lines (as the server would after validation). */
function drafted(ws: Workspace, lineIds: string[], runId = 'run-1') {
  ws = ok(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'fake/model', startedAt: '2026-10-19T16:00:00Z' }, runId)
  const manifest = manifestFor(ws, lineIds)
  ws = ok(ws, { type: 'record-draft-request', date: '2026-10-19', runId, requestHash: 'h', manifest })
  const proposals: DraftProposal[] = manifest.lines.map(l => ({ ...l, date: null }))
  return ok(ws, { type: 'set-model-draft', date: '2026-10-19', runId, taskIds: [], materialIds: [], proposals })
}
const prop = (ws: Workspace, lineId: string) => day(ws, '2026-10-19').draft!.proposals!.find(p => p.lineId === lineId)!

test('dates: the app reads one day from the line against the page it is on; the model date is kept only if it agrees', () => {
  assert.equal(resolveLineDate('周一给 Kevin 回电话', '2026-10-16', 2026), '2026-10-19') // Fri → Mon
  assert.equal(resolveLineDate('明天订酒店', '2026-10-18', 2026), '2026-10-19')
  assert.equal(resolveLineDate('明天订酒店', null, 2026), null) // no day above the page: no basis
  assert.equal(resolveLineDate('下周三交材料', '2026-10-16', 2026), '2026-10-21')
  assert.equal(resolveLineDate('下周看看 Notion 导出的格式', '2026-10-16', 2026), null) // a span, not a day
  assert.equal(resolveLineDate('deadline 2026-10-23', null, 2026), '2026-10-23') // absolute works anywhere
  assert.equal(resolveLineDate('10月23日 交税', null, 2026), '2026-10-23')
  assert.equal(resolveLineDate('call Kevin tomorrow or Friday', '2026-10-18', 2026), null) // two days: unsure
  assert.equal(resolveLineDate('奥德赛', '2026-10-18', 2026), null)
  // Ratchet ae9c7b87 3: "周五" with the model saying Saturday → no date.
  assert.equal(checkedDate('2026-10-24', '周五交报告', '2026-10-19', '2026-10-19'), null)
  assert.equal(checkedDate('2026-10-23', '周五交报告', '2026-10-19', '2026-10-19'), '2026-10-23')
  assert.equal(checkedDate('2026-10-19', '如果有空周一研究 TRMNL', '2026-10-16', '2026-10-19'), null) // "if I have time": never dated
  assert.equal(checkedDate('2026-10-16', '今天跑步', '2026-10-16', '2026-10-19'), null) // before the drafted day
  assert.equal(checkedDate('2026-10-19', '奥德赛', '2026-10-18', '2026-10-19'), null) // no date word: never a guess
})

test('a run: one at a time, one draft per day, ids outside the manifest refused, a stale run never applies', () => {
  let { ws } = world()
  ws = ok(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'fake/model', startedAt: 'x' }, 'r1')
  assert.equal(day(ws, '2026-10-19').draft!.run!.status, 'drafting')
  assert.deepEqual(day(ws, '2026-10-19').draft!.taskIds, []) // old-build fields always present
  assert.throws(() => run(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'm', startedAt: 'x' }, 'r2'), /Already drafting/)
  assert.equal(run(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'fake/model', startedAt: 'x' }, 'r1').workspace.revision, ws.revision, 'same op id replays')
  assert.throws(() => run(ws, { type: 'set-model-draft', date: '2026-10-19', runId: 'r1', taskIds: ['nope'], materialIds: [], proposals: [] }), /outside what was sent/)
  // Fails (e.g. timeout); Retry is a new run; the old run's late answer is refused.
  ws = ok(ws, { type: 'model-draft-failed', date: '2026-10-19', runId: 'r1', failure: 'unavailable' })
  assert.equal(day(ws, '2026-10-19').draftError, 'Model unavailable · nothing was added')
  ws = ok(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'fake/model', startedAt: 'y' }, 'r2')
  assert.equal(day(ws, '2026-10-19').draftError, undefined)
  assert.equal(day(ws, '2026-10-19').draft!.run!.run, 2)
  assert.throws(() => run(ws, { type: 'set-model-draft', date: '2026-10-19', runId: 'r1', taskIds: [], materialIds: [], proposals: [] }), /moved on/)
  ws = ok(ws, { type: 'set-model-draft', date: '2026-10-19', runId: 'r2', taskIds: [], materialIds: [], proposals: [] })
  assert.equal(day(ws, '2026-10-19').draft!.run!.status, 'ready')
  assert.throws(() => run(ws, { type: 'start-draft-run', date: '2026-10-19', model: 'm', startedAt: 'z' }), /already has a draft/)
  assert.throws(() => run(ws, { type: 'generate-draft', date: '2026-10-19', trigger: 'card' }), /already has a draft/)
  // Server-only: the browser can't send them.
  for (const type of ['start-draft-run', 'record-draft-request', 'set-model-draft', 'model-draft-failed'])
    assert.equal(commandSchema.safeParse({ operationId: 'x', expectedRevision: 0, action: { type, date: '2026-10-19', runId: 'r', model: 'm', startedAt: 'x', failure: 'busy' } }).success, false)
})

test('add-proposal: a new task with his line in the plan list; the line untouched; once only; Undo offers it again', () => {
  const { ws: w0, sun } = world()
  let ws = drafted(w0, [`${sun}/n1`])
  const before = JSON.stringify(day(ws, '2026-10-18').sections)
  const r = run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }, 'add-1')
  ws = r.workspace
  const t = ws.tasks.find(x => x.id === r.receipt.entityId)!
  assert.equal(t.title, '周一给 Kevin 回电话')
  assert.equal(t.plannedOn, '2026-10-19')
  const row = day(ws, '2026-10-19').sections.find(s => s.kind === 'other')!.blocks.find(b => b.taskId === t.id)!
  assert.deepEqual([row.sourcePageId, row.sourceBlockId], [sun, 'n1'])
  assert.equal(JSON.stringify(day(ws, '2026-10-18').sections), before, 'source line unchanged')
  assert.equal(isLineLinked(ws, sun, 'n1'), true)
  assert.equal(liveProposal(ws, prop(ws, `${sun}/n1`)), null)
  assert.equal(run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }, 'add-1').workspace.tasks.length, ws.tasks.length, 'same op replays')
  assert.throws(() => run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }), /changed; nothing was added/)
  ws = ok(ws, { type: 'undo', targetOperationId: 'add-1' })
  assert.equal(ws.tasks.some(x => x.title === '周一给 Kevin 回电话'), false)
  assert.ok(liveProposal(ws, prop(ws, `${sun}/n1`)))
})

test('deleting the new task row through save-editor still counts the line as carried forward', () => {
  const { ws: w0, sun } = world()
  let ws = ok(drafted(w0, [`${sun}/n1`]), { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` })
  const mon = day(ws, '2026-10-19')
  const rowId = mon.sections.flatMap(s => s.blocks).find(b => b.sourceBlockId === 'n1')!.id
  ws = edit(ws, mon.id, doc => doc.filter(n => n.id !== rowId))
  assert.equal(day(ws, '2026-10-19').sections.flatMap(s => s.blocks).some(b => b.id === rowId), false)
  assert.equal(isLineLinked(ws, sun, 'n1'), true)
  assert.equal(liveProposal(ws, prop(ws, `${sun}/n1`)), null)
})

test('the source changed after the run: an edit or a move under another day withdraws it; a section rename does not', () => {
  const { ws: w0, sun } = world()
  const base = drafted(w0, [`${sun}/n1`, 'trip/t1'])
  // Edited text: "已经打过" must not become a task.
  let ws = edit(base, sun, doc => doc.map(n => n.id === 'n1' ? { ...n, content: '已经给 Kevin 回过电话' } : n))
  assert.equal(liveProposal(ws, prop(ws, `${sun}/n1`)), null)
  assert.throws(() => run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }), /changed/)
  // Section renamed: still stands.
  ws = edit(base, sun, doc => doc.map(n => n.type === 'heading' && inlineText(n.content) === 'Notes' ? { ...n, content: 'Thoughts' } : n))
  assert.ok(liveProposal(ws, prop(ws, `${sun}/n1`)))
  // "明天" in a subpage moved from under Sun to under Mon: its date basis changed.
  ws = ok(base, { type: 'move-page', pageId: 'trip', parentId: day(base, '2026-10-19').id })
  assert.equal(liveProposal(ws, prop(ws, 'trip/t1')), null)
  // Its page in the trash.
  ws = ok(base, { type: 'delete-page', pageId: 'trip', at: '2026-10-19T17:00:00Z' })
  assert.equal(liveProposal(ws, prop(ws, 'trip/t1')), null)
  // Hide for today.
  ws = ok(base, { type: 'hide-proposal', date: '2026-10-19', lineId: 'trip/t1' })
  assert.deepEqual(day(ws, '2026-10-19').draft!.hidden, ['trip/t1'])
  assert.throws(() => run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: 'trip/t1' }), /not found/)
})

test('lines sent: text and links only, never tasks, cards or empty rows; the simulated card draft shows one example', () => {
  const { ws: w0, sun } = world()
  assert.deepEqual(draftLines(day(w0, '2026-10-18')).map(l => l.text), ['周一给 Kevin 回电话', '奥德赛'])
  const ws = ok(w0, { type: 'generate-draft', date: '2026-10-19', trigger: 'card' })
  assert.deepEqual(day(ws, '2026-10-19').draft!.proposals!.map(p => p.lineId), [`${sun}/n1`])
  assert.equal(day(ws, '2026-10-19').draft!.simulated, true)
  // The evening review's simulated draft never carries proposals (Lead, step 1).
  const review = ok(w0, { type: 'generate-draft', date: '2026-10-19' })
  assert.equal(day(review, '2026-10-19').draft!.proposals, undefined)
})

test('Ratchet #80: impossible dates in a line are no date, never an error', () => {
  for (const text of ['deadline 2026-13-40', 'on 99/99', '13月40日', '2/30 交材料'])
    assert.equal(resolveLineDate(text, '2026-10-18', 2026), null, text)
  assert.equal(checkedDate('2026-10-23', 'deadline 2026-13-40', '2026-10-18', '2026-10-19'), null)
})

test('a dated proposal is planned for its day, with no row on the drafted day; the line stays linked; Undo offers it again', () => {
  const { ws: w0, sun } = world()
  let ws = drafted(w0, [`${sun}/n1`])
  // As the server would keep it after checking: the line names Mon via "周一"; drafting Sun→Mon here uses Fri Oct 23.
  const d = day(ws, '2026-10-19')
  ws = { ...ws, pages: ws.pages.map(p => p.id === d.id ? { ...p, draft: { ...p.draft!, proposals: p.draft!.proposals!.map(x => ({ ...x, date: '2026-10-23' })) } } : p) }
  const rowsBefore = day(ws, '2026-10-19').sections.flatMap(s => s.blocks).length
  const r = run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }, 'add-dated')
  ws = r.workspace
  const t = ws.tasks.find(x => x.id === r.receipt.entityId)!
  assert.equal(t.plannedOn, '2026-10-23')
  assert.equal(ws.placements.find(x => x.taskId === t.id)!.date, '2026-10-23')
  assert.equal(day(ws, '2026-10-19').sections.flatMap(s => s.blocks).length, rowsBefore, 'no row on the drafted day')
  assert.equal(ws.pages.some(p => p.date === '2026-10-23'), false, 'no future page created')
  assert.equal(isLineLinked(ws, sun, 'n1'), true)
  assert.throws(() => run(ws, { type: 'add-proposal', date: '2026-10-19', lineId: `${sun}/n1` }), /changed/)
  ws = ok(ws, { type: 'undo', targetOperationId: 'add-dated' })
  assert.equal(ws.tasks.some(x => x.id === t.id), false)
  assert.equal(isLineLinked(ws, sun, 'n1'), false)
})
