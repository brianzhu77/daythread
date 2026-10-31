import assert from 'node:assert/strict'
import {harness,heading,todo,para,text,nodesOf,dayId} from '../../v2-helpers.ts'
import {flatNodes,inlineText} from '../../../src/domain/editor-document.ts'
const h=harness();h.run({type:'create-template',title:'Structured',pageId:'tpl',dayPage:true})
const template=[heading('h','Start'),{id:'divider',type:'divider',props:{},children:[]},{id:'toggle',type:'toggleListItem',props:{backgroundColor:'default',textColor:'default'},content:[text('Expandable prompt')],children:[todo('nested','Should not become a Task','reference',''),para('inside',text('Nested words'))]},{id:'code',type:'codeBlock',props:{language:'python'},content:[text('print("keep me")\n# second line')],children:[]}]
h.save('tpl',()=>template);const original=structuredClone(h.page('tpl'));const taskCount=h.ws.tasks.length;h.day('2026-11-01');const copy=nodesOf(h.page(dayId('2026-11-01'))),all=flatNodes(copy)
assert.deepEqual(h.page('tpl'),original);assert.equal(h.ws.tasks.length,taskCount)
assert.deepEqual(copy.map(n=>n.type),['heading','divider','toggleListItem','codeBlock']);assert.equal(copy[3].props.language,'python');assert.equal(inlineText(copy[3].content),'print("keep me")\n# second line');assert.equal(copy[2].children[0].type,'task');assert.equal(inlineText(copy[2].children[0].content),'');assert.equal(inlineText(copy[2].children[1].content),'Nested words');assert.ok(all.every(n=>!flatNodes(template).some(o=>o.id===n.id)));console.log('PASS divider/toggle/nested empty Task/code language+newlines copied, fresh IDs, no Task/source mutation')
