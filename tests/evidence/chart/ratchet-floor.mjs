import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const root=process.argv[2],state=JSON.parse(readFileSync(process.argv[3],'utf8'))
const {applyCommand}=await import(pathToFileURL(root+'/src/domain/workspace.ts'))
const {viewGroups,linkedViewOf}=await import(pathToFileURL(root+'/src/domain/database.ts'))
const db=state.pages.find(p=>p.id==='db'),v=db.database.views[0],settings=JSON.stringify(v.chart)
assert.doesNotThrow(()=>viewGroups(db.database,v,state.pages.filter(p=>p.parentId==='db')))
const result=applyCommand(state,{operationId:'old-label',expectedRevision:state.revision,action:{type:'change-database',pageId:'db',change:{kind:'updateView',viewId:v.id,name:'Old edit'}}})
const after=result.workspace.pages.find(p=>p.id==='db').database.views[0]
assert.equal(after.layout,'chart');assert.equal(JSON.stringify(after.chart),settings);assert.equal(after.groupDateBy,'week')
if(linkedViewOf){const linked=linkedViewOf(db.database,JSON.stringify(v));assert.equal(linked.layout,'chart');assert.equal(JSON.stringify(linked.chart),settings)}
writeFileSync(process.argv[3]+'.after',JSON.stringify(result.workspace))
console.log('PASS actual floor groups and old view rename retain chart/year and safe week groupDateBy')
