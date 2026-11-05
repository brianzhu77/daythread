import { chromium } from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(process.argv[2]);
const result=await page.evaluate(async()=>{
 const {Schema}=await import('/node_modules/.vite/deps/@tiptap_pm_model.js');const {EditorState,TextSelection}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');const {selectedWords,commentUnderlines,underlineKey}=await import('/src/components/comment-underlines.ts');
 const schema=new Schema({nodes:{doc:{content:'blockContainer+'},blockContainer:{content:'paragraph',attrs:{id:{default:''}}},paragraph:{content:'inline*',group:'block'},text:{group:'inline'},chip:{inline:true,group:'inline',atom:true}},marks:{strong:{}}});
 const doc=schema.node('doc',null,[schema.node('blockContainer',{id:'b'},[schema.node('paragraph',null,[schema.text('🙂甲 '),schema.node('chip'),schema.text(' repeat ',[schema.mark('strong')]),schema.text('repeat')])])]);
 const state=(from,to)=>EditorState.create({doc,selection:TextSelection.create(doc,from,to)});
 const text='🙂甲 ￼ repeat repeat';const at=text.lastIndexOf('repeat');const a=selectedWords(state(2+at,2+at+6)),back=selectedWords(state(2+at+6,2+at));
 const full=selectedWords(state(2,2+text.length));const ext=commentUnderlines(()=>[{blockId:'b',quote:'repeat',at}]);
 return {a,back,full,at,extensionKeys:Object.keys(ext)};
});assert.deepEqual(result.a,{blockId:'b',quote:'repeat',at:result.at});assert.deepEqual(result.back,result.a);assert.equal(result.full.quote,'🙂甲 ￼ repeat repeat');console.log('PASS Unicode, atom offsets, styled spans and backward selection',result);
}finally{await browser.close()}
