// Variables and formula values (docs/design/buttons.md §2, G3-10): worked out on the server at the tap, in step order, or the whole tap is dropped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, stepsKey, writeSteps, type ButtonStep, type ButtonSet } from '../src/domain/buttons.ts'
import { automationProblem, type Automation } from '../src/domain/automations.ts'
import { flatNodes, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { checkStepTyped, freshWorldOf, shownFormula } from '../src/domain/formula.ts'
import { stepFormulaProblems, variableNameProblem, variablesBefore } from '../src/domain/step-formulas.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
const n = 'prop("n")'
const formula = (id: string, name: string, text: string): ButtonSet => ({ id, name, value: { kind: 'formula', text } })
const define = (...vars: [string, string][]): ButtonStep => ({ id: `v${vars[0]![0]}`, kind: 'variables', vars: vars.map(([name, f]) => ({ id: name, name, formula: f })) })
const addRow = (set: ButtonSet[], over: object = {}): ButtonStep => ({ id: 'add', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Made', set, ...over })
const editRows = (set: ButtonSet[]): ButtonStep => ({ id: 'edit', kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [], set })
function setup(steps: ButtonStep[]) {
  const h = harness()
  const C = (change: unknown, pageId = 'runs') => h.run({ type: 'change-database', pageId, change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  C({ kind: 'addProperty', property: { id: 'w', name: 'When', type: 'date' } })
  C({ kind: 'addProperty', property: { id: 't', name: 'Note', type: 'text' } })
  C({ kind: 'addProperty', property: { id: 'c', name: 'Done', type: 'checkbox' } })
  C({ kind: 'addProperty', property: { id: 's', name: 'Stage', type: 'select', options: [{ id: 'o1', name: 'Open', color: 'gray' }, { id: 'o2', name: 'Shut', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'm', name: 'Tags', type: 'multiSelect', options: [{ id: 'a', name: 'Red', color: 'gray' }, { id: 'b', name: 'Blue', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'twice', name: 'Twice', type: 'formula', formula: `${n} * 2` } })
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { n: 2 }, at } as never)
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'p' })
  const button: EditorNode = { id: 'btn', type: 'button', props: { label: 'Go', steps: writeSteps(steps) }, children: [] }
  h.save('p', () => [button])
  return { h, C }
}
const tap = (h: ReturnType<typeof harness>, when = at) => {
  const page = h.page('p'), block = flatNodes(pageNodes(page)).find(x => x.id === 'btn')!
  return h.run({ type: 'run-button', pageId: 'p', blockId: 'btn', stepsKey: stepsKey(String(block.props?.steps)), expectedContent: pageContentKey(page), at: when, today })
}
const made = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.parentId === 'runs' && !p.trashedAt && !['r1', 'r2'].includes(p.id))

test('a variable reads the ones above it, a later step reads them all, and a row can take its name from one', () => {
  const { h } = setup([define(['a', '2'], ['b', 'a + 1']), define(['c', 'b * 10']), addRow([formula('n', 'N', 'a + c')], { titleFormula: '"Run " + c' })])
  tap(h)
  assert.equal(made(h).length, 1)
  assert.equal(made(h)[0]!.values?.n, 32)
  assert.equal(made(h)[0]!.title, 'Run 30')
})

test('Edit rows reads the row being edited, with a variable from the row tapped; each worked out before any is written', () => {
  const { h } = setup([define(['bump', '10']), editRows([formula('n', 'N', `${n} + bump`), formula('t', 'Note', `${n} + " was " + prop("twice")`)])])
  tap(h)
  assert.equal(h.page('r1').values?.n, 11)
  assert.equal(h.page('r2').values?.n, 12)
  assert.equal(h.page('r2').values?.t, '2 was 4', 'a formula property is worked out, as it reads before this step wrote')
})

test('a later step reads what an earlier one wrote', () => {
  const { h } = setup([editRows([formula('n', 'N', '5')]), editRows([formula('t', 'Note', `"now " + ${n}`)])])
  tap(h)
  assert.equal(h.page('r1').values?.t, 'now 5')
})

test('each kind of property takes its own form: a date, a tick, an option by name, several by name, and empty clears', () => {
  const { h } = setup([addRow([formula('w', 'When', 'dateAdd(now(), 1, "days")'), formula('c', 'Done', '1 > 0'), formula('s', 'Stage', '"shut"'), formula('m', 'Tags', '["Red", "Blue"]'), formula('t', 'Note', '""')])])
  tap(h)
  const v = made(h)[0]!.values!
  assert.match(String((v.w as { start: string }).start), /^2026-11-06/)
  assert.equal(v.c, true)
  assert.equal(v.s, 'o2')
  assert.deepEqual(v.m, ['a', 'b'])
  assert.equal(v.t, undefined)
})

test('the date is the tap\'s own, so running it again gives the same answer', () => {
  const { h } = setup([addRow([formula('t', 'Note', 'formatDate(now(), "YYYY-MM-DD HH:mm")')])])
  tap(h)
  const first = made(h)[0]!.values?.t
  assert.match(String(first), /^2026-11-05 /)
  // Worked out from the action's own time rather than the clock's, wherever and whenever it's run.
  const other = setup([addRow([formula('t', 'Note', 'formatDate(now(), "YYYY-MM-DD HH:mm")')])])
  tap(other.h, at)
  assert.equal(made(other.h)[0]!.values?.t, first)
})

test('one that can\'t work drops the whole tap, and says which step', () => {
  const later = setup([editRows([formula('n', 'N', '7')]), addRow([formula('s', 'Stage', '"Nope"')])])
  assert.throws(() => tap(later.h), /Add row to Runs: "Nope" isn't one of Stage's options/)
  assert.equal(later.h.page('r1').values?.n, 1, 'the step before it is dropped too')
  assert.equal(made(later.h).length, 0)

  const wrong = setup([editRows([formula('n', 'N', '"words"')])])
  assert.throws(() => tap(wrong.h), /Edit rows in Runs: N needs a number, and this gives text/)

  const missing = setup([addRow([formula('n', 'N', 'later')]), define(['later', '1'])])
  assert.throws(() => tap(missing.h), /Add row to Runs: N: There's no property or function called "later"/)

  // A list's item is whatever it is, so this one's only known at the tap.
  const runtime = setup([addRow([formula('n', 'N', 'at([1, "a"], 1)')])])
  assert.throws(() => tap(runtime.h), /Add row to Runs: N needs a number/)
})

test('a page has no row, so it can read its own name and nothing else', () => {
  const { h } = setup([])
  assert.ok('error' in checkStepTyped('N + 1', freshWorldOf(h.ws), '', new Map()))
  const own = checkStepTyped('"from " + Name', freshWorldOf(h.ws), '', new Map())
  assert.ok('stored' in own, JSON.stringify(own))
  const button = setup([addRow([formula('t', 'Note', own.stored)])])
  tap(button.h)
  assert.equal(made(button.h)[0]!.values?.t, 'from Notes')
})

test('a list with a formula is written as a version a floor build won\'t run; one without stays as it was', () => {
  const plain: ButtonStep[] = [addRow([])], withFormula = [addRow([formula('n', 'N', '1')])], withVariable = [define(['a', '1'])], named = [addRow([], { titleFormula: '"x"' })]
  assert.equal(JSON.parse(writeSteps(plain)).v, 1)
  for (const steps of [withFormula, withVariable, named]) {
    assert.equal(JSON.parse(writeSteps(steps)).v, 2)
    assert.deepEqual(readSteps(writeSteps(steps)), steps)
  }
  assert.deepEqual(readSteps(JSON.stringify({ v: 3, steps: plain })), [], 'a newer one still reads as none')
})

test('a variable\'s name has to read back as one, and what\'s written reads back with it', () => {
  for (const good of ['a', 'total_2', '总数']) assert.equal(variableNameProblem(good), null, good)
  for (const bad of ['two words', 'true', '1x', 'a+b']) assert.ok(variableNameProblem(bad), bad)
  assert.ok(variableNameProblem(''))
  const { h } = setup([])
  const world = freshWorldOf(h.ws), types = variablesBefore([define(['bump', '1'])], 1, world, 'runs')
  assert.equal(types.get('bump'), 'number')
  const typed = checkStepTyped('N + bump', world, 'runs', types)
  assert.ok('stored' in typed)
  assert.equal(typed.stored, 'prop("n") + bump')
  assert.equal(shownFormula(typed.stored, world, 'runs', types), 'N + bump')
  assert.deepEqual(stepFormulaProblems([define(['a', '1'], ['a', '2'])], world, 'runs'), ['Two variables are called a'])
})

test('on a rule: a formula reads the row that set it off, a schedule\'s has no row, and a deleted property shows without running', () => {
  const steps = writeSteps([define(['x', `${n} * 3`]), { id: 'e', kind: 'edit-property', set: [formula('t', 'Note', '"x=" + x')] }])
  const rule: Automation = { id: 'r', name: 'Note it', active: true, triggers: [{ kind: 'row-added' }], steps }
  const { h, C } = setup([])
  C({ kind: 'addAutomation', automation: rule })
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r3', title: 'Three', values: { n: 4 }, at } as never)
  assert.equal(h.page('r3').values?.t, 'x=12')
  const db = h.page('runs').database!
  assert.equal(automationProblem(h.ws, db, rule, 'runs'), null)
  const scheduled: Automation = { ...rule, steps: writeSteps([define(['x', `${n} * 3`])]), triggers: [{ kind: 'every', repeat: { every: 'day', interval: 1, start: '2026-11-01', time: '09:00' } }] }
  assert.match(automationProblem(h.ws, db, scheduled, 'runs') ?? '', /x: A property this formula reads was deleted/)
  C({ kind: 'removeProperty', propertyId: 'n' })
  assert.match(automationProblem(h.ws, h.page('runs').database!, rule, 'runs') ?? '', /x: A property this formula reads was deleted/)
})
