import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {chromium,webkit} from '@playwright/test';
const source=readdirSync('dist/server/assets').filter(n=>n.startsWith('functions-')).map(n=>readFileSync('dist/server/assets/'+n,'utf8')).join('\n');
const id=source.match(/prepareDayDraft_createServerFn_handler = createServerRpc\(\{\s*id: "([^"]+)/)[1];
const state=()=>{const db=new DatabaseSync('/tmp/ratchet257.sqlite');const s=JSON.parse(db.prepare('select data from workspace where id=1').get().data);db.close();return s;};
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]])for(const mode of ['late','owner','nav']){
 execFileSync(process.execPath,['tests/evidence/ratchet-draft-recovery/seed.ts']);
 const b=await engine.launch();const p=await b.newPage({viewport:{width,height:900},serviceWorkers:'block',timezoneId:'America/Vancouver'});
 await p.clock.install({time:new Date('2026-11-01T15:00:00Z')});
 let release,seen;const held=new Promise(r=>release=r),fetched=new Promise(r=>seen=r);let asks=0,sets=0;
 p.on('request',r=>{if((r.postData()??'').includes('set-draft'))sets++;});
 await p.route('**/_serverFn/**',async route=>{
  if(!route.request().url().includes('/_serverFn/'+id))return route.continue();
  const n=++asks,res=await route.fetch();let raw=await res.text();
  if(n===1){seen();await held;if(mode==='owner'){const changed=raw.replace('"s":"local"','"s":"different-owner"');assert.notEqual(changed,raw);raw=changed;}}
  if(mode==='late'&&n===2){
   // Exercise first-ready-wins without paying for a provider call: only the computed status is changed.
   const graph=JSON.parse(raw);let changed=false;
   const walk=v=>{if(!v||typeof v!=='object')return;if(typeof v.s==='string'&&v.s.includes('set-draft')){const next=v.s.replaceAll(String.raw`\"status\":\"failed\"`,String.raw`\"status\":\"ready\"`);if(next!==v.s){v.s=next;changed=true;}}for(const c of Object.values(v))walk(c);};walk(graph);assert.ok(changed);raw=JSON.stringify(graph);
  }
  return route.fulfill({response:res,body:raw});
 });
 await p.goto('http://127.0.0.1:3693/');await fetched;await p.locator('.continuous-editor').waitFor();
 if(mode==='late'){
  await p.clock.runFor(61_000);await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await p.locator('.draft-more-toggle').waitFor();await p.waitForTimeout(400);
  const before=state().pages.find(x=>x.type==='draft');assert.ok(before);
  release();await p.waitForTimeout(1000);
  const after=state().pages.filter(x=>x.type==='draft');assert.equal(after.length,1);assert.equal(after[0].document,before.document);assert.equal(asks,2);
 }else{
  const row=p.locator('.editor-task-title').filter({hasText:/^$/}).first();await row.click();await p.keyboard.type('Owned words');await p.waitForTimeout(900);
  if(mode==='nav'){await p.locator('a[href="/tasks"]:visible').first().click();await p.waitForFunction(()=>location.pathname==='/tasks');}
  release();await p.waitForTimeout(1000);assert.ok(state().tasks.some(t=>t.title==='Owned words'));
  const drafts=state().pages.filter(x=>x.type==='draft');
  if(mode==='owner'){assert.equal(sets,0);assert.equal(drafts.length,0);}else{assert.equal(drafts.length,1);assert.equal(drafts[0].parentId,'day:2026-11-01');}
 }
 console.log('PASS',name,mode,'asks',asks,'set attempts',sets);await b.close();
}
