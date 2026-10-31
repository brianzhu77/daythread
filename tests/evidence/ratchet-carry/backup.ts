import fs from 'node:fs'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {workspaceOf} from '../../../src/server/workspace-rows.ts'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {getDayView} from '../../../src/domain/workspace.ts'
import {pageNodes,flatNodes,inlineText} from '../../../src/domain/editor-document.ts'
const root='/Users/dogrod/Developer/daythread-backups/2026-10-31-before-b73/'
const read=name=>JSON.parse(fs.readFileSync(root+name+'.json','utf8'))
const pages=read('pages'),template=pages.find(p=>p.type==='template'&&p.parent_id==='days')
assert.ok(template)
const info=read('workspaces').find(w=>w.id===template.workspace_id)
assert.equal(info.timezone,'America/Vancouver')
const ws=workspaceOf({revision:info.revision,timezone:info.timezone,pages:pages.filter(p=>p.workspace_id===info.id),tasks:read('tasks').filter(t=>t.workspace_id===info.id),deleted:read('deleted_tasks').filter(t=>t.workspace_id===info.id)})
const tpl=ws.pages.find(p=>p.id===template.id),source=pageNodes(tpl)
assert.equal(flatNodes(source).length,25)
const repo=new SqliteWorkspaceRepository('/tmp/ratchet245-backup.sqlite')
await repo.load();const db=new DatabaseSync('/tmp/ratchet245-backup.sqlite');db.prepare('update workspace set revision=?,data=? where id=1').run(ws.revision,JSON.stringify(ws));db.close()
await repo.executeOnLatest(crypto.randomUUID(),{type:'ensure-day',date:'2026-11-01'})
let next=await repo.load();const made=next.pages.find(p=>p.date==='2026-11-01')
const shape=nodes=>nodes.map(n=>({type:n.type,props:n.type==='task'?{}:n.props,text:inlineText(n.content),children:shape(n.children??[])}))
assert.deepEqual(shape(pageNodes(made)),shape(source).map(n=>n.type==='task'?{...n,text:''}:n))
assert.equal(flatNodes(pageNodes(made)).filter(n=>n.type==='divider').length,2)
assert.equal(next.tasks.length,ws.tasks.length)
assert.ok(flatNodes(pageNodes(made)).every(n=>!flatNodes(source).some(old=>old.id===n.id)))
const handoff=getDayView(next,'2026-11-01').handoffTasks
assert.equal(handoff.length,2)
await repo.executeOnLatest(crypto.randomUUID(),{type:'plan-tasks',date:'2026-11-01',items:handoff.map(t=>({taskId:t.id}))})
next=await repo.load();const after=pageNodes(next.pages.find(p=>p.date==='2026-11-01'))
assert.equal(after[0].type,'heading');assert.deepEqual(after.slice(1,3).map(n=>n.props.taskId),handoff.map(t=>t.id))
assert.deepEqual(shape(after.slice(3)),shape(pageNodes(made).slice(1)))
assert.ok(after.filter(n=>n.type==='task'&&!inlineText(n.content).trim()).length===2)
const order=after.map(n=>`${n.type}${n.type==='heading'?' h'+n.props.level:''}: ${inlineText(n.content)}`)
fs.writeFileSync('/tmp/ratchet245-backup-order.txt',order.join('\n'))
console.log('PASS backup25blocks/Vancouver; exact copied structure/fresh IDs/2dividers/unchanged Tasks; AddAll group below heading; 2 empty slots preserved')
console.log('Nov1 midnight Vancouver:',new Date('2026-11-01T07:00:00Z').toLocaleString('en-CA',{timeZone:'America/Vancouver'}))
