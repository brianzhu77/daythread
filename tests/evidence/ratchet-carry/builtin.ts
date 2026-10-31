import fs from 'node:fs'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {applyCommand,createEmptyWorkspace} from '../../../src/domain/workspace.ts'
import {applyCommand as baseline} from '/Users/dogrod/Developer/daythread-ratchet-quiet/src/domain/workspace.ts'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {pageNodes,inlineText} from '../../../src/domain/editor-document.ts'
let base=createEmptyWorkspace()
const act=(ws,action,apply=applyCommand)=>apply(ws,{operationId:crypto.randomUUID(),expectedRevision:ws.revision,action}).workspace
base=act(base,{type:'ensure-day',date:'2026-10-31'})
for(const title of ['First carried item','Second carried item'])base=act(base,{type:'add-task',pageId:'day:2026-10-31',title,plannedOn:'2026-10-31'})
let revised=act(structuredClone(base),{type:'ensure-day',date:'2026-11-01'}),old=act(structuredClone(base),{type:'ensure-day',date:'2026-11-01'},baseline)
const items=base.tasks.map(t=>({taskId:t.id}))
revised=act(revised,{type:'plan-tasks',date:'2026-11-01',items});old=act(old,{type:'plan-tasks',date:'2026-11-01',items},baseline)
const shape=doc=>doc.map(n=>[n.type,inlineText(n.content),n.type==='task'?{role:n.props.role,planDate:n.props.planDate}:n.props,shape(n.children??[])])
assert.deepEqual(shape(pageNodes(revised.pages.at(-1))),shape(pageNodes(old.pages.at(-1))))
for(const [tag,ws] of [['new',revised],['old',old]]){const path=`/tmp/ratchet245-builtin-${tag}.sqlite`;await new SqliteWorkspaceRepository(path).load();const db=new DatabaseSync(path);db.prepare('update workspace set revision=?,data=? where id=1').run(ws.revision,JSON.stringify(ws));db.close()}
console.log('PASS built-in template and AddAll produce identical structure/content/row metadata before and after PR43')
