// Automations (docs/design/automations.md, G3-13 to G3-17): rules run inside the command that set them off, each on its own copy, with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, stepsKey, writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { automationProblem, withLiveNames, type Automation } from '../src/domain/automations.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z', today = '2026-11-05'
const setN = (raw: number, id = 'n', name = 'N'): ButtonStep => ({ id: `s-${id}`, kind: 'edit-property', set: [{ id, name, type: id === 'n' ? 'number' : 'text', value: { kind: 'fixed', raw } }] } as ButtonStep)
const rule = (over: Partial<Automation> = {}): Automation => ({ id: 'r', name: 'Log finish', active: true, triggers: [{ kind: 'property-edited', propertyId: 'st', name: 'Status', condition: { by: 'st', op: 'isAnyOf', value: ['done'] } }], steps: writeSteps([setN(5)]), ...over })
function setup(rules: Automation[] = []) {
  const h = harness()
  const C = (change: unknown, pageId = 'runs') => h.run({ type: 'change-database', pageId, change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  C({ kind: 'addProperty', property: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'Todo', color: 'gray' }, { id: 'done', name: 'Done', color: 'gray' }] } })
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1, st: 'todo' }, at } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { n: 2, st: 'todo' }, at } as never)
  for (const r of rules) C({ kind: 'addAutomation', automation: r })
  return { h, C }
}
const edit = (h: ReturnType<typeof harness>, id: string, values: object, expected: object) => h.run({ type: 'set-values', pageId: id, values, expected, at } as never)
const val = (h: ReturnType<typeof harness>, id: string, key = 'n') => h.page(id).values?.[key]
const rules = (h: ReturnType<typeof harness>) => h.page('runs').database!.automations ?? []


test('independent: restoring a Trash batch must not fire Row added',()=>{
 const {h}=setup([rule({triggers:[{kind:'row-added'}]})]);
 const del=h.run({type:'delete-page',pageId:'r1',at});const receipt=h.run({type:'restore-batch',trashId:del.receipt.operationId}).receipt;
 console.log('RESTORE_BATCH',{value:val(h,'r1'),automations:receipt.automations});assert.equal(val(h,'r1'),1);assert.equal(receipt.automations,undefined);
});
test('independent: incompatible trigger type must be reported broken',()=>{
 const {h,C}=setup([rule()]);C({kind:'updateProperty',propertyId:'st',type:'number'});
 const problem=automationProblem(h.ws,h.page('runs').database!,rules(h)[0]!);console.log('TRIGGER_TYPE',{problem});assert.ok(problem);
});
