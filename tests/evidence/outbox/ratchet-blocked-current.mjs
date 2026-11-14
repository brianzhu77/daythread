import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {DatabaseSync} from 'node:sqlite'
const [base='http://127.0.0.1:43844',file='/tmp/ratchet-outbox-recheck.sqlite']=process.argv.slice(2)
const db=new DatabaseSync(file);const ws=JSON.parse(db.prepare('select data from workspace').get().data);db.close();const id=ws.tasks.find(t=>t.title==='Water the plants').id; const bank=ws.tasks.find(t=>t.title==='Call the bank').id
const browser=await chromium.launch(),c=await browser.newContext({serviceWorkers:'block'}),a=await c.newPage(),b=await c.newPage()
for(const p of [a,b]){await p.goto(base+'/');await p.getByRole('checkbox',{name:'Complete Water the plants'}).waitFor();await p.waitForTimeout(500)}
await a.evaluate(({id,bank})=>new Promise(resolve=>{const r=indexedDB.open('daythread-outbox',1);r.onsuccess=()=>{const t=r.result.transaction('entries','readwrite');t.objectStore('entries').add({operationId:'held-water',owner:'local',action:{type:'task-status',taskId:id,status:'done',today:'2026-11-14'},baseRevision:8,ownRevisions:[],readsBeyond:false,writes:['task:'+id],refs:[id],label:'ticked Water',createdAt:Date.now(),state:'held',held:{reason:'conflict'}});t.objectStore('entries').add({operationId:'held-in-a',owner:'local',action:{type:'task-status',taskId:bank,status:'done',today:'2026-11-14'},baseRevision:8,ownRevisions:[],readsBeyond:false,writes:['task:'+bank],refs:[bank],label:'ticked Bank',createdAt:Date.now(),state:'pending'});t.oncomplete=()=>resolve()}}),{id,bank})
await a.close() // A left its committed pending entry behind; B must drain it.
const sends=[];b.on('request',r=>{if(r.url().includes('/_serverFn/cedd5fc6'))sends.push(r.postData())})
await b.getByRole('checkbox',{name:'Complete Water the plants'}).click();await b.waitForTimeout(1800)
console.log('Wire operations',sends.map(s=>s.includes('held-in-a')?'earlier-a':'later-b'))
await browser.close();assert.ok(sends[0]?.includes('held-in-a'),'an unrelated pending predecessor must drain even when the requested later entry is blocked')
