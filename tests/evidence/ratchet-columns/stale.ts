import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
const [path,mode]=process.argv.slice(2);const r=new SqliteWorkspaceRepository(path!,undefined,{allowMissingLegacy:true});let ws=await r.load();const run=async(action:any)=>{ws=(await r.execute({operationId:crypto.randomUUID(),expectedRevision:ws.revision,action})).workspace};const view=ws.pages.find(p=>p.id==='list')!.database!.views[0]!;
await run({type:'change-database',pageId:'list',change:{kind:'updateView',viewId:view.id,colourRules:[{id:'colour',rule:{by:'kind',op:'isAnyOf',value:['novel']},tint:'red',scope:'property'}],frozenThrough:'kind'}})
if(mode==='deleted')await run({type:'change-database',pageId:'list',change:{kind:'removeProperty',propertyId:'kind'}})
else await run({type:'change-database',pageId:'list',change:{kind:'updateView',viewId:view.id,columns:view.columns.filter(c=>c.id!=='kind')}})
