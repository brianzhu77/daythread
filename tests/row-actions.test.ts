import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey } from '../src/domain/editor-document.ts'
import type { Action, Page, Workspace } from '../src/domain/types.ts'

// A12 (docs/plan/a12-row-actions.md §1, §2, §5): row actions on the day page, on the existing task commands.
const yesterday = '2026-10-15', today = '2026-10-16', tomorrow = '2026-10-17', friday = '2026-10-18'

function setup() {
  let state = createEmptyWorkspace(), sequence = 0
  const run = (action: Action, operationId = `a12-${++sequence}`) => {
    const result = applyCommand(state, { operationId, expectedRevision: state.revision, action })
    state = result.workspace
    return result
  }
  const day = (date: string) => {
    run({ type: 'ensure-day', date })
    return state.pages.find(p => p.date === date)!
  }
  const add = (date: string, title: string, kind: 'top3' | 'other' = 'other') => {
    const page = day(date)
    run({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(s => s.kind === kind)!.id, title, plannedOn: date })
    return state.tasks.at(-1)!
  }
  const page = (date: string) => state.pages.find(p => p.date === date)!
  return { run, day, add, page, get state() { return state } }
}
const rows = (p: Page, kind: 'top3' | 'other') => p.sections.filter(s => s.kind === kind).flatMap(s => s.blocks).filter(b => b.kind === 'task').map(b => b.text)

test('a move from today keeps the section; the row leaves today and lands on the new day', () => {
  const s = setup(), t = s.add(today, 'Write report', 'top3')
  s.day(tomorrow)
  const r = s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'top3', from: today, today })
  assert.deepEqual(rows(s.page(today), 'top3'), [])
  assert.deepEqual(rows(s.page(tomorrow), 'top3'), ['Write report'])
  assert.equal(s.state.tasks[0]!.plannedOn, tomorrow)
  assert.equal(r.receipt.message, `Planned for ${tomorrow}`)
})

test('a full Top 3 on the new day sends the row to the plan list, said in the receipt', () => {
  const s = setup(), t = s.add(today, 'Fourth', 'top3')
  for (const title of ['A', 'B', 'C']) s.add(tomorrow, title, 'top3')
  const r = s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'top3', from: today, today })
  assert.deepEqual(rows(s.page(tomorrow), 'top3'), ['A', 'B', 'C'])
  assert.deepEqual(rows(s.page(tomorrow), 'other'), ['Fourth'])
  assert.equal(r.receipt.message, `Planned for ${tomorrow} · Top 3 is full · added to TODO - Other`)
  assert.equal(s.state.placements.find(p => p.taskId === t.id && p.date === tomorrow)!.section, 'other')
})

test('a task already in the new day\'s full Top 3 doesn\'t count against itself (Ratchet)', () => {
  const s = setup(), t = s.add(tomorrow, 'Mine', 'top3')
  s.add(tomorrow, 'B', 'top3'); s.add(tomorrow, 'C', 'top3')
  // The same task also shows on today's page (e.g. it was dragged there), and is moved back to tomorrow from today.
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'top3' })
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'top3' })
  assert.deepEqual(rows(s.page(tomorrow), 'top3'), ['B', 'C', 'Mine'])
  const r = s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'top3', from: today, today })
  assert.deepEqual(rows(s.page(tomorrow), 'top3'), ['B', 'C', 'Mine'])
  assert.equal(r.receipt.message, `Planned for ${tomorrow}`)
})

test('Move to Top 3 on the same page is allowed with three rows there (no from)', () => {
  const s = setup()
  for (const title of ['A', 'B', 'C']) s.add(today, title, 'top3')
  const t = s.add(today, 'D', 'other')
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'top3' })
  assert.deepEqual(rows(s.page(today), 'top3'), ['A', 'B', 'C', 'D'])
  assert.deepEqual(rows(s.page(today), 'other'), [])
})

test('a past page keeps its row: from before today removes nothing', () => {
  const s = setup(), t = s.add(yesterday, 'Old', 'other')
  s.day(today)
  s.run({ type: 'plan-task', taskId: t.id, date: today, section: 'other', from: yesterday, today })
  assert.deepEqual(rows(s.page(yesterday), 'other'), ['Old'])
  assert.deepEqual(rows(s.page(today), 'other'), ['Old'])
  // The evening review opened after midnight acts on yesterday: same rule.
  assert.equal(s.state.tasks[0]!.plannedOn, today)
})

test('without from, plan-task behaves as before: the old page keeps the row and nothing falls back', () => {
  const s = setup(), t = s.add(today, 'Keep', 'top3')
  for (const title of ['A', 'B', 'C']) s.add(tomorrow, title, 'top3')
  s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, section: 'top3' })
  assert.deepEqual(rows(s.page(today), 'top3'), ['Keep'])
  assert.deepEqual(rows(s.page(tomorrow), 'top3'), ['A', 'B', 'C', 'Keep'])
})

test('from without today is refused', () => {
  const s = setup(), t = s.add(today, 'X')
  assert.throws(() => s.run({ type: 'plan-task', taskId: t.id, date: tomorrow, from: today }), /needs today/)
})

test('Not on {day} with onlyThisDay: planned here pauses (D05); planned elsewhere only removes the row', () => {
  const s = setup(), here = s.add(today, 'Here'), moved = s.add(today, 'Moved')
  s.run({ type: 'not-today', taskId: here.id, date: today, onlyThisDay: true })
  assert.equal(s.state.tasks[0]!.paused, true)
  assert.equal(s.state.tasks[0]!.plannedOn, null)
  // Moved to Friday on another device a moment ago; this page still shows the stale row.
  s.day(friday)
  s.run({ type: 'plan-task', taskId: moved.id, date: friday })
  assert.deepEqual(rows(s.page(today), 'other'), ['Moved'])
  const before = structuredClone(s.state.tasks[1])
  const r = s.run({ type: 'not-today', taskId: moved.id, date: today, onlyThisDay: true })
  assert.deepEqual(rows(s.page(today), 'other'), [])
  assert.deepEqual(rows(s.page(friday), 'other'), ['Moved'])
  assert.deepEqual(s.state.tasks[1], before)
  assert.equal(r.receipt.message, `Removed from ${today} · still planned for ${friday}`)
})

test('not-today without onlyThisDay is unchanged: it pauses even when planned elsewhere', () => {
  const s = setup(), t = s.add(today, 'T')
  s.run({ type: 'plan-task', taskId: t.id, date: friday })
  s.run({ type: 'not-today', taskId: t.id, date: today })
  assert.equal(s.state.tasks[0]!.paused, true)
  assert.equal(s.state.tasks[0]!.plannedOn, friday)
})

test('Undo of each action puts the row back in its section and position, with the task\'s dates and pause', () => {
  const cases: [string, (s: ReturnType<typeof setup>, id: string) => Action][] = [
    ['Tomorrow', (_s, id) => ({ type: 'plan-task', taskId: id, date: tomorrow, section: 'top3', from: today, today })],
    ['Not today', (_s, id) => ({ type: 'not-today', taskId: id, date: today, onlyThisDay: true })],
    ['Move to Other', (_s, id) => ({ type: 'plan-task', taskId: id, date: today, section: 'other' })],
    ['Cancel', (_s, id) => ({ type: 'task-status', taskId: id, status: 'cancelled' })],
  ]
  for (const [name, action] of cases) {
    const s = setup()
    s.add(today, 'First', 'top3'); const t = s.add(today, 'Middle', 'top3'); s.add(today, 'Last', 'top3')
    s.day(tomorrow)
    const before = structuredClone({ page: s.page(today).sections, task: s.state.tasks[1], placements: s.state.placements })
    s.run(action(s, t.id), `act-${name}`)
    s.run({ type: 'undo', targetOperationId: `act-${name}` })
    assert.deepEqual(s.page(today).sections, before.page, name)
    assert.deepEqual(s.state.tasks[1], before.task, name)
    assert.deepEqual(s.state.placements, before.placements, name)
  }
})

test('Not today by action and by deleting the whole row leave the same task and placement state', () => {
  const byAction = setup(), a = byAction.add(today, 'Same', 'top3')
  byAction.run({ type: 'not-today', taskId: a.id, date: today, onlyThisDay: true })

  const byDelete = setup(); byDelete.add(today, 'Same', 'top3')
  const p = byDelete.page(today), doc = editorSeed(p, byDelete.state), row = doc.find(n => n.type === 'task')!
  byDelete.run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc.filter(n => n.id !== row.id)), singleDeleteIds: [row.id], today })

  const strip = (ws: Workspace) => ({ tasks: ws.tasks.map(({ id: _id, sourcePageId: _s, ...t }) => t), placements: ws.placements.map(({ taskId: _t, ...p }) => p) })
  assert.deepEqual(strip(byAction.state), strip(byDelete.state))
  assert.deepEqual(rows(byAction.page(today), 'top3'), rows(byDelete.page(today), 'top3'))
})

test('a day with no page yet counts its Top 3 placements: the fourth move falls back to Other (Ratchet b8dac42e)', () => {
  const s = setup()
  const ids = ['One', 'Two', 'Three', 'Four'].map(t => s.add(today, t, 'top3').id)
  // Friday has no page: the first three moves fill its Top 3 as placements only.
  for (const id of ids.slice(0, 3)) s.run({ type: 'plan-task', taskId: id, date: friday, section: 'top3', from: today, today })
  assert.equal(s.state.pages.some(p => p.date === friday), false)
  const r = s.run({ type: 'plan-task', taskId: ids[3]!, date: friday, section: 'top3', from: today, today })
  assert.match(r.receipt.message, /Top 3 is full · added to TODO - Other$/)
  assert.equal(s.state.placements.find(p => p.taskId === ids[3] && p.date === friday)!.section, 'other')
  // Moving one of the three again doesn't count itself.
  const again = s.run({ type: 'plan-task', taskId: ids[0]!, date: friday, section: 'top3', from: today, today })
  assert.equal(again.receipt.message, `Planned for ${friday}`)
  // When Friday's page is created, it shows three in Top 3 and the fourth in Other.
  s.day(friday)
  assert.deepEqual(rows(s.page(friday), 'top3').sort(), ['One', 'Three', 'Two'])
  assert.deepEqual(rows(s.page(friday), 'other'), ['Four'])
})
