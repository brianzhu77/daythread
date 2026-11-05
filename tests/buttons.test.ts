// Buttons (docs/design/buttons.md §4, G3-4 to G3-8): every step of a tap in one operation, with one Undo, or none of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, safeUrl, stepProblem, stepsKey, valueAtTap, writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { calcChoices, cellValue, groupableProperties, todosSourceId } from '../src/domain/database.ts'
import { pageFromTemplate } from '../src/domain/day-template.ts'
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
test('a template doesn\'t run, and a day made from it has its own button', () => {
  const h = setup([addRow()])
  h.run({ type: 'create-document', title: 'Day template', body: '', pageId: 'tpl' })
  const tplId = h.ws.pages.find(p => p.title === 'Day template')!.id
  assert.ok(tplId)
  const made = pageFromTemplate({ document: JSON.stringify([button([addRow()], 'in-template')]) } as never, '2026-11-05')
  assert.equal(made[0]!.type, 'button')
  assert.notEqual(made[0]!.id, 'in-template')
  assert.equal(made[0]!.props?.steps, writeSteps([addRow()]))
})
test('Ratchet: a page Open can\'t reach stops the tap before anything\'s written', () => {
  const open = (pageId: string): ButtonStep => ({ id: 'o', kind: 'open', target: { kind: 'page', pageId, name: 'Elsewhere' } })
  const gone = setup([addRow(), open('nothing')]), n = rows(gone).length
  assert.throws(() => tap(gone), /Elsewhere was deleted/)
  assert.equal(rows(gone).length, n)
  const trashed = setup([addRow(), open('other')])
  trashed.run({ type: 'create-document', title: 'Other', body: '', pageId: 'other' })
  trashed.run({ type: 'delete-page', pageId: 'other', at })
  assert.throws(() => tap(trashed), /Other is in Trash/)
  assert.equal(rows(trashed).length, n)
  assert.throws(() => tap(setup([addRow(), { id: 'u', kind: 'open', target: { kind: 'url', url: 'javascript:alert(1)' } }])), /can't be opened/)
})
test('a to-do that can\'t take the edit reads as the bar\'s does, with one Undo over the rest; if none can, later steps carry on (Lead 371ebb4b)', () => {
  const step = (filter: unknown[] = []): ButtonStep => ({ id: 's', kind: 'edit-rows', databaseId: todosSourceId, databaseName: 'To-dos', filter, set: [{ id: 'planned', name: 'Planned', value: { kind: 'fixed', raw: { start: '2026-11-07' } } }] }) as ButtonStep
  const day = (h: ReturnType<typeof harness>) => { h.run({ type: 'ensure-day', date: '2026-11-06' }); h.run({ type: 'add-task', pageId: 'day:2026-11-06', title: 'Open one', plannedOn: '2026-11-06' }); h.run({ type: 'add-task', pageId: 'day:2026-11-06', title: 'Finished', plannedOn: '2026-11-06' }); h.run({ type: 'task-status', taskId: h.task('Finished').id, status: 'done', today: '2026-11-06' }) }
  const h = setup([addRow(), step()]); day(h)
  const n = rows(h).length, { receipt } = tap(h, 'btn', 'p', '2026-11-06')
  assert.match(receipt.message, /1 to-do changed · 1 couldn't/)
  assert.equal(rows(h).length, n + 1)
  assert.ok(h.ws.pages.some(p => p.date === '2026-11-07'), 'the open one moved')
  h.run({ type: 'undo', targetOperationId: receipt.operationId })
  assert.equal(rows(h).length, n, 'one Undo over both')
  const none = setup([step(), addRow()])
  none.run({ type: 'ensure-day', date: '2026-11-06' }); none.run({ type: 'add-task', pageId: 'day:2026-11-06', title: 'Finished', plannedOn: '2026-11-06' }); none.run({ type: 'task-status', taskId: none.task('Finished').id, status: 'done', today: '2026-11-06' })
  assert.equal(tap(none, 'btn', 'p', '2026-11-06').receipt.message, 'Added to Runs', 'a step none could take doesn\'t stop the next')
  const alone = setup([step()])
  alone.run({ type: 'ensure-day', date: '2026-11-06' }); alone.run({ type: 'add-task', pageId: 'day:2026-11-06', title: 'Finished', plannedOn: '2026-11-06' }); alone.run({ type: 'task-status', taskId: alone.task('Finished').id, status: 'done', today: '2026-11-06' })
  const revision = alone.ws.revision
  assert.throws(() => tap(alone, 'btn', 'p', '2026-11-06'))
  assert.equal(alone.ws.revision, revision, 'nothing changed at all is no operation')
})
test('Ratchet: to-dos inserted count against the same 500 across steps', () => {
  const many = Array.from({ length: 501 }, (_, i) => line(`t${i}`, `To-do ${i}`, 'checkListItem'))
  const h = setup([{ id: 'i', kind: 'insert', place: 'below', blocks: many }]), tasks = h.ws.tasks.length
  assert.throws(() => tap(h), /500 to-dos at most/)
  assert.equal(h.ws.tasks.length, tasks)
  const half = Array.from({ length: 300 }, (_, i) => line(`u${i}`, `To-do ${i}`, 'checkListItem'))
  const both = setup([{ id: 'i', kind: 'insert', place: 'below', blocks: half }, { id: 'j', kind: 'insert', place: 'above', blocks: half }])
  assert.throws(() => tap(both), /500 to-dos at most/)
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
test('in a synced block it\'s one button: a tap in another place runs, and what it inserts reaches every place', () => {
  const block = (id: string, syncId: string, children: EditorNode[] = []): EditorNode => ({ id, type: 'syncedBlock', props: { syncId, roles: '' }, children })
  const h = harness()
  for (const [id, title] of [['a', 'A'], ['b', 'B']] as const) h.run({ type: 'create-document', title, body: '', pageId: id })
  const steps: ButtonStep[] = [{ id: 'i', kind: 'insert', place: 'below', blocks: [line('new', 'From the synced button')] }]
  h.save('a', d => [...d, block('sa', 's1', [button(steps, 'shared')])])
  h.save('b', d => [...d, block('sb', 's1')])
  const inB = flatNodes(pageNodes(h.page('b'))).find(n => n.type === 'button')!
  assert.ok(inB, 'it shows in the other place')
  const { receipt } = tap(h, inB.id, 'b')
  assert.equal(receipt.message, 'Inserted')
  // By line, as the button's own steps hold the same words.
  const read = (id: string) => flatNodes(pageNodes(h.page(id))).filter(n => n.type !== 'button').map(n => JSON.stringify(n.content ?? '')).join()
  for (const id of ['a', 'b']) assert.ok(read(id).includes('From the synced button'), id)
  assert.equal(flatNodes(pageNodes(h.page('a'))).filter(n => n.type === 'button').length, 1)
  h.run({ type: 'undo', targetOperationId: receipt.operationId })
  for (const id of ['a', 'b']) assert.equal(read(id).includes('From the synced button'), false, id)
})
test('in the Day template: new days have their own, a tap on one writes to that day, and the day draft holds it as a line, not a slot', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } } } as never)
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  const on: ButtonStep[] = [{ id: 'a', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Run', set: [{ id: 'when', name: 'When', value: { kind: 'day' } }] }]
  h.save('tpl', () => [button(on, 'in-template'), line('t1', 'Notes')])
  assert.throws(() => tap(h, 'in-template', 'tpl'), /template doesn't run/)
  const day1 = h.day('2026-11-05'), day2 = h.day('2026-11-06')
  const of = (p: { document: string }) => pageNodes(p).find(n => n.type === 'button')!
  assert.ok(of(day1) && of(day2))
  assert.notEqual(of(day1).id, of(day2).id)
  assert.equal(of(day1).props?.steps, writeSteps(on))
  const { receipt } = tap(h, of(day2).id, day2.id, '2026-11-20')
  assert.deepEqual(h.page(receipt.entityId!).values?.when, { start: '2026-11-06' }, 'that day, not the day it was tapped')
})

const rowButton = (steps: ButtonStep[]) => (h: ReturnType<typeof harness>) => { h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'go', name: 'Go', type: 'button', button: { label: 'Bump', steps: writeSteps(steps) } } } } as never); return writeSteps(steps) }
const tapRows = (h: ReturnType<typeof harness>, stored: string, rowIds: string[], tapDay = today) => h.run({ type: 'run-row-button', databaseId: 'runs', propertyId: 'go', rowIds, stepsKey: stepsKey(stored), at, today: tapDay })
const setN = (raw: number): ButtonStep => ({ id: 'e', kind: 'edit-property', set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw } }] })
test('the property: Edit property on its row, on several with one Undo, reading the row\'s own values; it holds no value and reads its label', () => {
  const h = setup([]), stored = rowButton([setN(5)])(h)
  assert.equal(tapRows(h, stored, ['r1']).receipt.message, '1 row changed')
  assert.deepEqual(rows(h).map(r => r.values?.n), [5, 2])
  assert.equal('go' in (h.page('r1').values ?? {}), false)
  const both = tapRows(h, stored, ['r1', 'r2'])
  assert.equal(both.receipt.message, '2 rows changed')
  assert.deepEqual(rows(h).map(r => r.values?.n), [5, 5])
  h.run({ type: 'undo', targetOperationId: both.receipt.operationId })
  assert.deepEqual(rows(h).map(r => r.values?.n), [5, 2], 'one Undo, across both')
  assert.equal(cellValue(h.page('runs').database!, h.page('r1'), 'go'), 'Bump')
})
test('the property: a row\'s own date with @this page, a Multi-select added to and taken from, and Add row linking back', () => {
  const h = setup([])
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'a', name: 'A', color: 'gray' }, { id: 'b', name: 'B', color: 'gray' }] } } } as never)
  const adds = rowButton([{ id: 'e', kind: 'edit-property', set: [{ id: 'tags', name: 'Tags', value: { kind: 'fixed', raw: ['a'] }, mode: 'add' }, { id: 'when', name: 'When', value: { kind: 'today' } }] }])(h)
  tapRows(h, adds, ['r1'], '2026-11-05'); tapRows(h, adds, ['r1'], '2026-11-05')
  assert.deepEqual(h.page('r1').values?.tags, ['a'])
  assert.deepEqual(h.page('r1').values?.when, { start: '2026-11-05' })
  const removes = writeSteps([{ id: 'e', kind: 'edit-property', set: [{ id: 'tags', name: 'Tags', value: { kind: 'fixed', raw: ['a'] }, mode: 'remove' }] }])
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'updateProperty', propertyId: 'go', button: { label: 'Bump', steps: removes } } } as never)
  tapRows(h, removes, ['r1'])
  assert.deepEqual(h.page('r1').values?.tags ?? [], [])
})
test('the property: all or none across rows, a changed button refused, a broken property named, a trashed row refused, and limits across rows', () => {
  const h = setup([]), stored = rowButton([setN(5)])(h), rev = h.ws.revision
  assert.throws(() => h.run({ type: 'run-row-button', databaseId: 'runs', propertyId: 'go', rowIds: ['r1'], stepsKey: 'old', at, today }), /Changed elsewhere/)
  assert.throws(() => tapRows(h, stored, ['r1', 'nothing']), /./)
  assert.deepEqual(rows(h).map(r => r.values?.n), [1, 2], 'the first row isn\'t kept')
  assert.equal(h.ws.revision, rev)
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'removeProperty', propertyId: 'n' } } as never)
  assert.throws(() => tapRows(h, stored, ['r1']), /N was deleted/)
})
test('not for sort, filter, Group or Rollup; a retry on rows makes one change; it survives a save and a rename', () => {
  const h = setup([]), stored = rowButton([{ ...addRow(), id: 'a' }])(h)
  const db = h.page('runs').database!
  assert.equal(groupableProperties(db, 'board').some(p => p.id === 'go'), false)
  assert.deepEqual(calcChoices('button'), [])
  const action = { type: 'run-row-button' as const, databaseId: 'runs', propertyId: 'go', rowIds: ['r1'], stepsKey: stepsKey(stored), at, today }
  const before = rows(h).length, first = h.run(action, 'tap-rows'), second = h.run(action, 'tap-rows')
  assert.equal(second.receipt.entityId, first.receipt.entityId)
  assert.equal(rows(h).length, before + 1)
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'updateProperty', propertyId: 'go', name: 'Renamed' } } as never)
  assert.equal(h.page('runs').database!.properties.find(p => p.id === 'go')!.button?.steps, stored)
})
