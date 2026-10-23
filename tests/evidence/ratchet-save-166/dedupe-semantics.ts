import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withoutSaved} from '../../../src/components/draft-slots.ts'
import {mergeDraft} from '../../../src/domain/draft-merge.ts'
import {inlineText,type EditorNode} from '../../../src/domain/editor-document.ts'
const recover=(base:EditorNode[],draft:EditorNode[],latest=base,known=new Set<string>())=>mergeDraft(base,withoutSaved(draft,latest),latest,known)
test('unchanged parent retains newly typed child',()=>{
 const p:EditorNode={id:'p',type:'paragraph',content:'Parent',children:[]};
 const result=recover([p],[{...p,children:[{id:'c',type:'paragraph',content:'UNSAVED CHILD'}]}]);
 assert.ok(JSON.stringify(result.document).includes('UNSAVED CHILD'))
})
test('intentional same-words text with a different block id survives',()=>{
 const p:EditorNode={id:'old',type:'paragraph',content:'Call Mom'};
 const result=recover([p],[p,{...p,id:'new'}]);assert.equal(result.document.filter(n=>inlineText(n.content)==='Call Mom').length,2)
})
test('intentional same-words task with a different task id survives',()=>{
 const p:EditorNode={id:'old',type:'task',props:{taskId:'old-task'},content:'Call Mom'};
 const result=recover([p],[p,{...p,id:'new',props:{taskId:'editor-task:new'}}],[p],new Set(['old-task']));
 assert.equal(result.document.filter(n=>n.type==='task').length,2);assert.ok(result.document.some(n=>n.props?.taskId==='editor-task:new'))
})
test('offline checklist tick survives even when words and block id match',()=>{
 const p:EditorNode={id:'check',type:'sourceChecklist',props:{checked:false},content:'Call Mom'};
 const result=recover([p],[{...p,props:{checked:true}}]);assert.equal(result.document[0].props?.checked,true)
})
