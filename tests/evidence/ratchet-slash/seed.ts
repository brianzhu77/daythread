import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceRepository } from "../../../src/server/sqlite-repository.ts";
import { applyCommand, createEmptyWorkspace } from "../../../src/domain/workspace.ts";
import {pageContentKey} from "../../../src/domain/editor-document.ts";
const repo = new SqliteWorkspaceRepository("/tmp/ratchet255.sqlite");
await repo.load();
let ws = createEmptyWorkspace();
let n = 0;
const run = action => {ws = applyCommand(ws, {operationId:`seed-${++n}`,expectedRevision:ws.revision,action}).workspace;};
if(process.argv.includes('--page')) {
  run({type:'create-document',pageId:'review',title:'Review page',body:'Own text'});
  run({type:'create-document',pageId:'target',title:'Target page',body:'Destination'});
}
if(process.argv.includes('--mid') || process.argv.includes('--task')) {
 const page=ws.pages.find(p=>p.id==='review');
 const line={id:'slot',type:process.argv.includes('--task')?'task':'paragraph',props:process.argv.includes('--task')?{taskId:'editor-task:guard',role:'reference',planDate:''}:{},content:[],children:[]};
 const doc=[{id:'own',type:'paragraph',props:{},content:[{type:'text',text:'Own text',styles:{}}],children:[]},line];
 if(process.argv.includes('--mid'))doc.push({id:'next',type:'heading',props:{level:2},content:[{type:'text',text:'Untouched heading',styles:{}}],children:[]});
 run({type:'save-editor',pageId:'review',expectedContent:pageContentKey(page),document:JSON.stringify(doc),today:'2026-11-01'});
}
if(process.argv.includes('--native')) {
  const page=ws.pages.find(p=>p.id==='review');
  const doc=Array.from({length:24},(_,i)=>({id:`native-${i}`,type:'paragraph',props:{},content:[{type:'text',text:i===20?'':`Test line ${i}`,styles:{}}],children:[]}));
  run({type:'save-editor',pageId:'review',expectedContent:pageContentKey(page),document:JSON.stringify(doc),today:'2026-11-01'});
}
const db = new DatabaseSync("/tmp/ratchet255.sqlite");
db.prepare("update workspace set revision=?,data=? where id=1").run(
  ws.revision,
  JSON.stringify(ws),
);
db.close();
