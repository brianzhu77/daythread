// A Button may read a source row while writing only a different new row.
import assert from 'node:assert/strict'
import { harness, today } from '../../v2-helpers.ts'
import { writeSteps, stepsKey } from '../../../src/domain/buttons.ts'
import { applyCommand } from '../../../src/domain/workspace.ts'
import { rowsOf, planWrites } from '../../../src/server/workspace-rows.ts'
const h = harness(), at='2026-11-14T10:00:00Z'
for (const id of ['src','dest']) h.run({type:'create-database',pageId:id,homeBlockId:null,title:id})
h.run({type:'change-database',pageId:'src',change:{kind:'addProperty',property:{id:'n',name:'N',type:'number'}}} as never)
h.run({type:'change-database',pageId:'dest',change:{kind:'addProperty',property:{id:'n',name:'N',type:'number'}}} as never)
h.run({type:'add-row',databaseId:'src',pageId:'s',title:'Source',values:{n:1},at} as never)
const stored=writeSteps([{id:'copy',kind:'add-row',databaseId:'dest',databaseName:'dest',title:'Copy',set:[{id:'n',name:'N',value:{kind:'row',id:'n'}}]}])
h.run({type:'change-database',pageId:'src',change:{kind:'addProperty',property:{id:'go',name:'Go',type:'button',button:{label:'Copy',steps:stored}}}} as never)
const action={type:'run-row-button' as const,databaseId:'src',propertyId:'go',rowIds:['s'],stepsKey:stepsKey(stored),at,today}
function predicted(ws:typeof h.ws) {
 const result=applyCommand(ws,{operationId:'copy-row',expectedRevision:ws.revision,action})
 const write=planWrites(rowsOf(ws),result.workspace).write
 assert(!write.pages.upsert.some(p=>p.id==='s'), 'Source not written')
 return result.workspace.pages.find(p=>p.id==='copy-row:s:0') ?? result.workspace.pages.find(p=>p.parentId==='dest')!
}
assert.equal(predicted(h.ws).values?.n,1)
const changed=structuredClone(h.ws); changed.pages.find(p=>p.id==='s')!.values={n:9}; changed.revision++
assert.equal(predicted(changed).values?.n,9)
console.log('PASS: same action reads changed source value; source is absent from its write set')
const dbMake=applyCommand(h.ws,{operationId:'make-db',expectedRevision:h.ws.revision,action:{type:'create-database',pageId:'new-db',homeBlockId:null,title:'New'}}).workspace
const rowAdd=applyCommand(dbMake,{operationId:'add-child',expectedRevision:dbMake.revision,action:{type:'add-row',databaseId:'new-db',pageId:'child',title:'Child',at}})
const added=planWrites(rowsOf(dbMake),rowAdd.workspace).write
assert(added.pages.upsert.some(p=>p.id==='child'))
assert(!added.pages.upsert.some(p=>p.id==='new-db'))
console.log('PASS: add-row references newly created database but does not write its parent row')
