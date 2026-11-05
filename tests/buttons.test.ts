// Buttons (docs/design/buttons.md §4, G3-4 to G3-8): every step of a tap in one operation, with one Undo, or none of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, safeUrl, stepProblem, stepsKey, valueAtTap, writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { todosSourceId } from '../src/domain/database.ts'
import { flatNodes, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
const line = (id: string, text: string, type = 'paragraph'): EditorNode => ({ id, type, props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const button = (steps: ButtonStep[], id = 'btn'): EditorNode => ({ id, type: 'button', props: { label: 'Go', steps: writeSteps(steps) }, children: [] })
function setup(steps: ButtonStep[], around: EditorNode[] = []) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } } } as never)
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { n: 2 }, at } as never)
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'p' })
  h.save('p', () => [line('a', 'Above'), button(steps), line('z', 'Below'), ...around])
  return h
}
const tap = (h: ReturnType<typeof harness>, blockId = 'btn', pageId = 'p', tapDay = today) => {
  const page = h.page(pageId), block = flatNodes(pageNodes(page)).find(n => n.id === blockId)!
  return h.run({ type: 'run-button', pageId, blockId, stepsKey: stepsKey(String(block.props?.steps)), expectedContent: pageContentKey(page), at, today: tapDay })
}
const ids = (h: ReturnType<typeof harness>, id = 'p') => pageNodes(h.page(id)).map(n => n.id)
const addRow = (id = 's1'): ButtonStep => ({ id, kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Run', set: [{ id: 'when', name: 'When', value: { kind: 'today' } }] })
const editAll = (id = 's2', n = 9): ButtonStep => ({ id, kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [], set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: n } }] })
const rows = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.parentId === 'runs' && !p.trashedAt)

test('Add row: with today read at the tap, the notice names it, and it can open', () => {
  const h = setup([addRow()])
  const { receipt } = tap(h, 'btn', 'p', '2026-11-05')
  assert.equal(receipt.message, 'Added to Runs')
  const row = h.page(receipt.entityId!)
  assert.equal(row.title, 'Run')
  assert.deepEqual(row.values?.when, { start: '2026-11-05' })
})
test('Edit rows: every match, or carrying on past none, with "No rows matched" only if nothing at all changed', () => {
  const h = setup([editAll()])
  assert.equal(tap(h).receipt.message, '2 rows changed')
  assert.deepEqual(rows(h).map(r => r.values?.n), [9, 9])
  const none: ButtonStep = { ...editAll(), filter: [{ by: 'n', op: 'eq', value: 100 }] } as ButtonStep
  const lone = setup([none]), rev = lone.ws.revision
  assert.throws(() => tap(lone), /No rows matched/)
  assert.equal(lone.ws.revision, rev)
  const both = setup([addRow(), none])
  assert.equal(tap(both).receipt.message, 'Added to Runs', 'the row isn\'t lost because nothing matched')
  assert.equal(rows(both).length, 3)
})
test('one tap, one Undo, across every step; a step that fails leaves nothing and names itself', () => {
  const steps: ButtonStep[] = [{ id: 's0', kind: 'insert', place: 'below', blocks: [line('new', 'Inserted line')] }, addRow(), editAll()]
  const h = setup(steps), before = h.page('p').document, { receipt } = tap(h)
  assert.equal(receipt.message, '3 rows changed', 'the last step\'s words')
  assert.equal(rows(h).length, 3)
  assert.equal(pageNodes(h.page('p')).length, 4)
  h.run({ type: 'undo', targetOperationId: receipt.operationId })
  assert.equal(h.page('p').document, before)
  assert.equal(rows(h).length, 2)
  assert.deepEqual(rows(h).map(r => r.values?.n), [1, 2])
  const bad = setup([addRow(), { ...editAll(), set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: 'not a number' } }] }])
  const rev = bad.ws.revision
  assert.throws(() => tap(bad), /Edit rows in Runs: /)
  assert.equal(bad.ws.revision, rev)
  assert.equal(rows(bad).length, 2, 'the row from the step before it isn\'t kept')
})
test('Insert blocks: above, below, top and bottom; each tap has new ids, and to-dos are new tasks each time', () => {
  const blocks = [line('x', 'Words'), line('t', 'A to-do', 'checkListItem')]
  for (const [place, at_] of [['above', 1], ['below', 2], ['top', 0]] as const) {
    const h = setup([{ id: 's', kind: 'insert', place, blocks }])
    tap(h)
    assert.equal(ids(h).indexOf('btn'), place === 'above' ? 3 : place === 'top' ? 3 : 1)
    assert.equal(pageNodes(h.page('p'))[at_]!.content ? JSON.stringify(pageNodes(h.page('p'))[at_]!.content).includes('Words') : false, true, place)
  }
  const h = setup([{ id: 's', kind: 'insert', place: 'bottom', blocks }])
  const before = h.ws.tasks.length
  tap(h); tap(h)
  const tasks = h.ws.tasks.slice(before)
  assert.equal(tasks.length, 2)
  assert.notEqual(tasks[0]!.id, tasks[1]!.id)
  assert.equal(tasks[0]!.title, 'A to-do')
  const all = flatNodes(pageNodes(h.page('p'))).map(n => n.id)
  assert.equal(new Set(all).size, all.length)
  assert.equal(all.includes('x'), false, 'what\'s written in the step keeps its own ids')
})
test('on a day page a to-do is planned that day; @this page\'s day is the page\'s, not today\'s', () => {
  const h = setup([])
  const old = '2026-10-01'
  h.day(old)
  h.save(`day:${old}`, () => [button([{ id: 's', kind: 'insert', place: 'below', blocks: [line('t', 'From the button', 'checkListItem')] }, { id: 's2', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Old', set: [{ id: 'when', name: 'When', value: { kind: 'day' } }] }], 'on-day')])
  const { receipt } = tap(h, 'on-day', `day:${old}`, '2026-11-05')
  assert.deepEqual(h.page(receipt.entityId!).values?.when, { start: old })
  const task = h.ws.tasks.find(t => t.title === 'From the button')!
  assert.ok(task)
  assert.ok(pageNodes(h.page(`day:${old}`)).some(n => n.props?.taskId === task.id && n.props?.planDate === old))
})
test('To-dos: Add row is its + New, and Edit rows its task commands', () => {
  const h = setup([{ id: 's', kind: 'add-row', databaseId: todosSourceId, databaseName: 'To-dos', title: 'Call', set: [{ id: 'planned', name: 'Planned', value: { kind: 'fixed', raw: { start: '2026-11-06' } } }] }])
  const { receipt } = tap(h, 'btn', 'p', '2026-11-05')
  assert.equal(receipt.message, 'Added to To-dos')
  const task = h.ws.tasks.find(t => t.title === 'Call')!
  assert.ok(pageNodes(h.page('day:2026-11-06')).some(n => n.props?.taskId === task.id))
  const e = setup([{ id: 's', kind: 'edit-rows', databaseId: todosSourceId, databaseName: 'To-dos', filter: [], set: [{ id: 'planned', name: 'Planned', value: { kind: 'fixed', raw: { start: '2026-11-07' } } }] }])
  assert.throws(() => tap(e), /No rows matched/)
  e.run({ type: 'ensure-day', date: '2026-11-06' })
  e.run({ type: 'add-task', pageId: 'day:2026-11-06', title: 'One', plannedOn: '2026-11-06' })
  assert.match(tap(e, 'btn', 'p', '2026-11-05').receipt.message, /1 to-do changed/)
})
test('broken targets say so at the tap, the pill stays, and other steps don\'t run', () => {
  const h = setup([addRow(), editAll()])
  h.run({ type: 'delete-page', pageId: 'runs', at })
  const count = h.ws.pages.length
  assert.throws(() => tap(h), /Runs is in Trash/)
  assert.equal(h.ws.pages.length, count)
  assert.ok(ids(h).includes('btn'))
  const p = setup([{ id: 's0', kind: 'insert', place: 'below', blocks: [line('x', 'No')] }, { ...editAll(), set: [{ id: 'gone', name: 'Status', value: { kind: 'fixed', raw: 1 } }] }])
  assert.throws(() => tap(p), /^Error: Status was deleted$|Status was deleted/)
  assert.equal(pageNodes(p.page('p')).length, 3)
  const g = setup([{ ...addRow(), databaseId: 'nothing', databaseName: 'Old' }])
  assert.throws(() => tap(g), /Old was deleted/)
})
test('a changed button or page is refused; a template doesn\'t run; a retry makes one row', () => {
  const h = setup([addRow()]), page = h.page('p'), key = stepsKey(String(pageNodes(page)[1]!.props?.steps)), content = pageContentKey(page)
  assert.throws(() => h.run({ type: 'run-button', pageId: 'p', blockId: 'btn', stepsKey: 'other', expectedContent: content, at, today }), /Changed elsewhere/)
  assert.throws(() => h.run({ type: 'run-button', pageId: 'p', blockId: 'gone', stepsKey: key, expectedContent: content, at, today }), /That button's gone/)
  const words = setup([{ id: 's', kind: 'insert', place: 'below', blocks: [line('x', 'New')] }]), stale = pageContentKey(words.page('p'))
  words.save('p', () => [button([{ id: 's', kind: 'insert', place: 'below', blocks: [line('x', 'New')] }]), line('later', 'Typed since')])
  assert.throws(() => words.run({ type: 'run-button', pageId: 'p', blockId: 'btn', stepsKey: stepsKey(writeSteps([{ id: 's', kind: 'insert', place: 'below', blocks: [line('x', 'New')] }])), expectedContent: stale, at, today }), /Changed elsewhere/)
  const before = rows(h).length, action = { type: 'run-button' as const, pageId: 'p', blockId: 'btn', stepsKey: key, expectedContent: content, at, today }
  const first = h.run(action, 'tap-1'), second = h.run(action, 'tap-1')
  assert.equal(second.receipt.entityId, first.receipt.entityId)
  assert.equal(rows(h).length, before + 1)
})
test('limits count across steps, and steps from a newer build don\'t run', () => {
  const h = setup([editAll('a'), editAll('b')])
  assert.equal(tap(h).receipt.message, '2 rows changed')
  assert.deepEqual(readSteps('[{"kind":"addRow"}]'), [])
  assert.deepEqual(readSteps(JSON.stringify({ v: 2, steps: [{ kind: 'new' }] })), [])
  const newer = setup([])
  newer.save('p', () => [{ id: 'btn', type: 'button', props: { label: 'Go', steps: JSON.stringify({ v: 2, steps: [{ kind: 'new' }] }) }, children: [] }])
  assert.throws(() => tap(newer), /Nothing to do/)
})
test('what a step needs, and links that can\'t run script', () => {
  assert.equal(stepProblem({ id: 'a', kind: 'add-row', databaseId: '', databaseName: '', title: '', set: [] }), 'Needs a database')
  assert.equal(stepProblem({ id: 'a', kind: 'confirm', text: ' ' }), 'Needs its words')
  assert.equal(stepProblem({ id: 'a', kind: 'open', target: { kind: 'made' } }, []), 'Needs an Add row step before it')
  assert.equal(stepProblem({ id: 'a', kind: 'open', target: { kind: 'made' } }, [addRow()]), null)
  assert.equal(safeUrl('javascript:alert(1)'), null)
  assert.equal(safeUrl('data:text/html,x'), null)
  assert.equal(safeUrl('example.com/a'), 'https://example.com/a')
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c')
  assert.deepEqual(valueAtTap({ kind: 'page' }, { type: 'relation' }, { id: 'p', date: null, title: 'T' }, today), ['p'])
})
