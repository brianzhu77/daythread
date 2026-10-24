import {spawn} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
const [width='1280',mode='success']=process.argv.slice(2),port=process.env.PORT??'3594',base=`http://127.0.0.1:${port}`;
const db=`/tmp/rb-b47/ratchet192-${mode}-${width}-${Date.now()}.sqlite`;
const repo=new SqliteWorkspaceRepository(db,'/tmp/rb-b47/ratchet-ws-356.json');
let ws=await repo.load();assert.equal(ws.revision,356);
const date='2026-10-24',evening=structuredClone(ws.pages.find(p=>p.date===date).draft);
assert.ok(evening&&!evening.run&&!evening.proposals);
const titles=evening.taskIds.map(id=>ws.tasks.find(t=>t.id===id).title);
// A valid candidate outside yesterday's handoff, to distinguish the run's added rows.
await repo.executeOnLatest(crypto.randomUUID(),{type:'create-document',pageId:'fixture-doc',title:'Fixture document',body:''});
ws=await repo.load();let doc=ws.pages.find(p=>p.id==='fixture-doc');
const add=await repo.executeOnLatest(crypto.randomUUID(),{type:'add-task',pageId:doc.id,sectionId:doc.sections[0].id,title:'Fixture model-only task',plannedOn:null});
ws=add.workspace;const newId=ws.tasks.find(t=>t.title==='Fixture model-only task').id;
const otherMaterial=ws.materials.find(m=>!evening.materialIds.includes(m.id))?.id;
let calls=0;const provider=http.createServer(async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/models')return res.end(JSON.stringify({data:[{id:'fixture/model',pricing:{prompt:'0',completion:'0'}}]}));
 if(req.url!=='/chat/completions'){res.statusCode=404;return res.end('{}')}
 for await(const _ of req){} calls++;
 await new Promise(r=>setTimeout(r,1000));
 const answer=mode==='retry'&&calls===1?{}:{taskIds:[evening.taskIds[0],newId,evening.taskIds[0]],materialIds:[evening.materialIds[0],...(otherMaterial?[otherMaterial]:[])],proposals:[]};
 res.end(JSON.stringify({id:`fixture-${calls}`,choices:[{message:{content:JSON.stringify(answer)}}],usage:{cost:0,prompt_tokens:1,completion_tokens:1}}));
});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',port,'--strictPort'],{env:{...process.env,DAYTHREAD_STORAGE:'sqlite',DAYTHREAD_SQLITE_PATH:db,DAYTHREAD_AUTH:'off',OPENROUTER_API_KEY:'fixture-only',OPENROUTER_MODEL:'fixture/model',OPENROUTER_BASE_URL:`http://127.0.0.1:${provider.address().port}`,DAYTHREAD_LINK_PREVIEW:'off'},stdio:'ignore'});
let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await(Number(width)<600?webkit:chromium).launch();const p=await browser.newPage({viewport:{width:Number(width),height:900},...(Number(width)<600?{hasTouch:true,isMobile:true}:{})});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const until=async fn=>{for(let i=0;i<90;i++){if(await fn())return true;await p.waitForTimeout(200)}return false};
 const draft=async()=>(await repo.load()).pages.find(p=>p.date===date).draft;
 const rows=()=>p.locator('.start-the-day .mc-row').evaluateAll(es=>es.map(e=>({title:e.querySelector('.mc-title')?.textContent.trim(),reason:e.querySelector('.mc-reason')?.textContent.trim()})));
 const picks=async()=>{const r=await rows();assert.deepEqual(r.slice(0,3).map(r=>r.title),titles);assert.ok(r.slice(0,3).every(r=>r.reason==='Suggested last night'));assert.equal(new Set(r.map(r=>r.title)).size,r.length)};
 const log=s=>console.log(`PASS ${width} ${mode}: ${s}`);
 await p.goto(base,{waitUntil:'networkidle'});await p.waitForTimeout(700);await picks();assert.equal(await p.locator('.start-the-day .sim,.fact-block.related .sim').count(),0);
 const related=await p.locator('.fact-block.related .fact-row').allTextContents();assert.equal(related.length,2);log('rev356 evening rows/links and no Simulated');
 await p.locator('.start-the-day').getByRole('button',{name:'Draft my day',exact:true}).click();
 assert.ok(await until(async()=>Boolean((await draft())?.run)));await picks();assert.deepEqual((await draft()).evening,{taskIds:evening.taskIds,materialIds:evening.materialIds});log('real-run path starts and preserves evening picks while drafting');
 if(mode==='retry'){
  assert.ok(await until(async()=>(await draft())?.run?.status==='failed'));await picks();assert.deepEqual((await draft()).evening,{taskIds:evening.taskIds,materialIds:evening.materialIds});
  await p.locator('.start-the-day').getByRole('button',{name:'Retry',exact:true}).click();log('failed run keeps picks and Retry is usable');
 }
 assert.ok(await until(async()=>(await draft())?.run?.status==='ready'));await p.waitForTimeout(700);await picks();
 const r=await rows();assert.ok(r.some(r=>r.title==='Fixture model-only task'&&r.reason==='Drafted for today'));
 assert.deepEqual(await p.locator('.fact-block.related .fact-row').allTextContents(),related);
 assert.equal(await p.locator('.start-the-day .sim,.fact-block.related .sim').count(),0);assert.equal(calls,mode==='retry'?2:1);log('new model task appended, duplicate removed, two evening links retain priority');
 await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(700);await picks();assert.equal(errors.length,0);log('reload retains picks; no page errors');
 await p.locator('.start-the-day').getByRole('button',{name:'Add all tasks',exact:true}).click();await p.waitForTimeout(1000);
 const final=await repo.load(),page=final.pages.find(p=>p.date===date);const top=page.sections.find(s=>s.kind==='top3').blocks.filter(b=>b.taskId).map(b=>b.taskId);
 assert.deepEqual(top,evening.taskIds);assert.ok(page.sections.find(s=>s.kind==='other').blocks.some(b=>b.taskId===newId));log('Add all respects Top3 limit and sends model-only task to Other');
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.on('exit',r));provider.closeAllConnections();await new Promise(r=>provider.close(r))}
