import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SqliteWorkspaceRepository} from '../src/server/sqlite-repository.ts'
import {configureDebug,debugClient,formatDebug} from '../src/lib/debug.ts'

test('debug logs default off; enabled commands correlate and never serialize content or exception messages',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'daythread-debug-')),prior=process.env.DAYTHREAD_LOG,original=console.debug,lines:string[]=[]
 console.debug=(line:unknown)=>{lines.push(String(line))}
 try {
  delete process.env.DAYTHREAD_LOG
  const r=new SqliteWorkspaceRepository(join(directory,'workspace.sqlite'))
  await r.load();assert.equal(lines.length,0)
  process.env.DAYTHREAD_LOG='debug'
  const first=await r.execute({operationId:'create-day',expectedRevision:0,action:{type:'ensure-day',date:'2026-10-17'}})
  const p=first.workspace.pages[0]!
  const command={operationId:'save-private',expectedRevision:1,action:{type:'add-task' as const,pageId:p.id,title:'SECRET_NOTE_SENTINEL'}}
  await r.execute(command);await r.execute(command)
  await assert.rejects(r.execute({...command,action:{...command.action,title:'SECRET_OTHER_SENTINEL'}}))
  const logs=lines.map(s=>JSON.parse(s))
  assert(logs.some(l=>l.operationId==='save-private'&&l.result==='committed'))
  assert(logs.some(l=>l.operationId==='save-private'&&l.result==='replay'))
  assert(logs.some(l=>l.operationId==='save-private'&&l.result==='error'))
  assert(!lines.join('\n').includes('SECRET_'));assert(!lines.join('\n').includes('fingerprint'))
  assert(!formatDebug('safe',{operationId:'op',...{text:'SECRET_NOTE_SENTINEL',message:'SECRET_MESSAGE'}}).includes('SECRET'))
  lines.length=0;configureDebug(false);debugClient('client',{operationId:'op'});assert.equal(lines.length,0)
  configureDebug(true);debugClient('client',{operationId:'same-op',pageId:'page',result:'ok'});assert.equal(JSON.parse(lines[0]!).operationId,'same-op')
 }finally{console.debug=original;configureDebug(false);if(prior===undefined)delete process.env.DAYTHREAD_LOG;else process.env.DAYTHREAD_LOG=prior;await rm(directory,{recursive:true,force:true})}
})
