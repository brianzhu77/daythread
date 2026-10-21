import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts';
const r=new SqliteWorkspaceRepository('/private/tmp/ratchet91.sqlite');
const run=(action:any)=>r.executeOnLatest(crypto.randomUUID(),action);
for(const [date,title] of [['2026-10-20','Ratchet Cancel Probe'],['2026-10-20','Ratchet Putback Probe'],['2026-10-19','Ratchet Handoff Probe']]){
await run({type:'ensure-day',date});let w=await r.load();let p=w.pages.find(p=>p.date===date)!;await run({type:'add-task',pageId:p.id,sectionId:p.sections.find(s=>s.kind==='other')!.id,title,plannedOn:date});
if(title.includes('Putback')){w=await r.load();p=w.pages.find(p=>p.date===date)!;const t=w.tasks.find(t=>t.title===title)!;const doc=editorSeed(p,w).filter(n=>n.props?.taskId!==t.id);await run({type:'save-editor',pageId:p.id,expectedContent:pageContentKey(p),document:JSON.stringify(doc)});}
}
console.log('fixtures ready');
