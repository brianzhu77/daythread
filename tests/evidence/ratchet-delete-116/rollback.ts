import assert from 'node:assert/strict';
import {applyCommand,createEmptyWorkspace} from '../../../src/domain/workspace.ts';
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts';
import {applyCommand as oldApply} from '/Users/dogrod/Developer/daythread-ratchet-stray-line/src/domain/workspace.ts';
import {editorSeed as oldSeed,pageContentKey as oldKey} from '/Users/dogrod/Developer/daythread-ratchet-stray-line/src/domain/editor-document.ts';
let w=applyCommand(createEmptyWorkspace(),{operationId:crypto.randomUUID(),expectedRevision:0,action:{type:'ensure-day',date:'2026-10-22'}}).workspace;
let p=w.pages[0]!;const id=p.sections.find(s=>s.kind==='other')!.id;p.sections.find(s=>s.id===id)!.kind='custom';p.editorBlockMetadata={};
for(const [apply,seed,key,label] of [[applyCommand,editorSeed,pageContentKey,'new repair'],[oldApply,oldSeed,oldKey,'old save'],[applyCommand,editorSeed,pageContentKey,'new reload']] as const){p=w.pages[0]!;w=apply(w,{operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'save-editor',pageId:p.id,expectedContent:key(p),document:JSON.stringify(seed(p,w)),today:'2026-10-22'}}).workspace;assert.equal(w.pages[0]!.sections.find(s=>s.id===id)!.kind,'other');assert.equal(w.pages[0]!.sections.filter(s=>s.kind==='other').length,1);console.log('PASS',label);}
