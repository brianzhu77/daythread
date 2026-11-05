// Buttons (docs/design/buttons.md §4, G3-4 to G3-8): every step of a tap in one operation, with one Undo, or none of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, safeUrl, stepProblem, stepsKey, valueAtTap, writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { todosSourceId } from '../src/domain/database.ts'
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



test('accepted partial refusal retains successful changes',()=>{
 const h=setup([addRow(),{id:'todos',kind:'edit-rows',databaseId:todosSourceId,databaseName:'To-dos',filter:[],set:[{id:'planned',name:'Planned',value:{kind:'fixed',raw:{start:'2026-11-07'}}}]}]);h.day(today);
 h.run({type:'add-task',pageId:'day:'+today,title:'Finished',plannedOn:today});const task=h.ws.tasks.find(t=>t.title==='Finished')!;h.run({type:'task-status',taskId:task.id,status:'done',today});
 h.run({type:'add-task',pageId:'day:'+today,title:'Open one',plannedOn:today});const r=tap(h);assert.match(r.receipt.message,/couldn't/);assert.equal(rows(h).length,3);
});
test('invalid To-dos value must abort rather than keep mutations before throw',()=>{
 const h=setup([addRow(),{id:'todos',kind:'edit-rows',databaseId:todosSourceId,databaseName:'To-dos',filter:[],set:[{id:'status',name:'Status',value:{kind:'fixed',raw:'open'}},{id:'planned',name:'Planned',value:{kind:'fixed',raw:{start:'2026-99-99'}}}]}]);h.day(today);
 h.run({type:'add-task',pageId:'day:'+today,title:'Finished',plannedOn:today});const task=h.ws.tasks.find(t=>t.title==='Finished')!;h.run({type:'task-status',taskId:task.id,status:'done',today});
 const before=h.ws.revision;let error='',message='';try{message=tap(h).receipt.message}catch(e){error=String(e)};
 console.log('INVALID_TODO',{error,message,rows:rows(h).length,status:h.ws.tasks.find(t=>t.id===task.id)?.status});assert.equal(h.ws.revision,before);
});
