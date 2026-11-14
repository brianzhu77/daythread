import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,bullet,text} from './v2-helpers.ts'
import {collectInput,smartNoteBlockType,type SmartRange} from '../src/domain/smart-note.ts'
import {untouchedDay} from '../src/domain/day-template.ts'
import type {EditorNode} from '../src/domain/editor-document.ts'
const day='2026-11-14';const range:SmartRange={where:{kind:'workspace'},days:0};
const note=(id:string):EditorNode=>({id,type:smartNoteBlockType,props:{noteId:id},children:[]}) as EditorNode;
const key=(h:ReturnType<typeof harness>)=>collectInput(h.ws,range,day).key;
test('Ratchet: the relaxed smart-note comparison does not change ordinary untouched-day callers',()=>{
 const h=harness(), p=h.day(day); assert(untouchedDay(h.ws)(p)); const before=key(h);
 h.save(p.id,d=>[...d,note('one'),note('two')]);
 assert.equal(untouchedDay(h.ws)(h.page(p.id)),false);
 assert.equal(key(h),before);
 const restored=harness(JSON.parse(JSON.stringify(h.ws)));assert.equal(key(restored),before);
 h.save(p.id,d=>d.filter(n=>n.type!==smartNoteBlockType));assert.equal(key(h),before);
});
test('Ratchet: custom day-template text stays unread after note placement, while a real edit is read',()=>{
 const h=harness();h.run({type:'create-template',title:'Day',pageId:'tpl',dayPage:true});
 h.save('tpl',()=>[bullet('tpl-line',text('My daily checklist'))]);
 const p=h.day(day),before=key(h);
 h.save(p.id,d=>[...d,note('one')]);assert.equal(key(h),before);
 h.save(p.id,d=>[...d,bullet('actual',text('Book the train'))]);
 assert.notEqual(key(h),before);
 assert(collectInput(h.ws,range,day).pages.flatMap(p=>p.lines).some(l=>l.text.includes('Book the train')));
});
