import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SqliteWorkspaceRepository as Old} from '../../../../daythread-ratchet-trash-old/src/server/sqlite-repository.ts'
import {SqliteWorkspaceRepository as New} from '../../../src/server/sqlite-repository.ts'
const dir=mkdtempSync(join(tmpdir(),'ratchet-trash77-real-')),p=join(dir,'workspace.sqlite')
const source=new DatabaseSync('/Users/dogrod/Developer/daythread/.daythread-local/workspace.sqlite',{readOnly:true});source.prepare('VACUUM INTO ?').run(p);source.close()
const before=await new Old(p).load(),r=new New(p),after=await r.load();assert.deepEqual(after,before)
const d=new DatabaseSync(p);assert.equal(d.prepare('PRAGMA user_version').get()!.user_version,4);d.close()
const recipe=after.pages.find(x=>x.title==='韩国大酱汤')!;assert.ok(recipe)
const result=await r.execute({operationId:'review-real-rename',expectedRevision:after.revision,action:{type:'rename-page',pageId:recipe.id,title:recipe.title+' review'}})
assert.deepEqual(result.workspace.tasks,after.tasks);assert.deepEqual(result.workspace.placements,after.placements);assert.deepEqual(result.workspace.materials,after.materials)
const undone=await r.execute({operationId:'review-real-undo',expectedRevision:result.workspace.revision,action:{type:'undo',targetOperationId:'review-real-rename'}})
assert.deepEqual(undone.workspace.pages,after.pages)
console.log('PASS real database read-only backup: layout3→4 preserves complete workspace; save+Undo preserves pages/tasks/placements/materials')
console.log('copy '+p)
