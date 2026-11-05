// Variables and formula values (docs/design/buttons.md §2, G3-10): worked out on the server at the tap, in step order, or the whole tap is dropped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, stepsKey, writeSteps, type ButtonStep, type ButtonSet } from '../src/domain/buttons.ts'
import { automationProblem, type Automation } from '../src/domain/automations.ts'
import { todosSourceId } from '../src/domain/database.ts'
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


test('independent: slow relation read after an earlier Add row sees the new row',()=>{
 const {h,C}=setup([]);C({kind:'addProperty',property:{id:'rel',name:'Related',type:'relation',target:'runs'}});
 const op='ratchet-fresh';const steps:ButtonStep[]=[define(['before','prop("rel").length()']),addRow([{id:'n',name:'N',value:{kind:'fixed',raw:7}}]),{id:'link',kind:'edit-property',set:[{id:'rel',name:'Related',value:{kind:'fixed',raw:[op+':r1:1']}}]},{id:'read',kind:'edit-property',set:[formula('t','Note','format(prop("rel").map(current.prop("n")).sum())')]}];
 C({kind:'addProperty',property:{id:'go',name:'Go',type:'button',button:{label:'Go',steps:writeSteps(steps)}}});
 h.run({type:'run-row-button',databaseId:'runs',propertyId:'go',rowIds:['r1'],stepsKey:stepsKey(writeSteps(steps)),at,today},op);assert.equal(h.page('r1').values?.t,'7');assert.ok(h.page(op+':r1:1'));
});
