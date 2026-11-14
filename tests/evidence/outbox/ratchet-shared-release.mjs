import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {DatabaseSync} from 'node:sqlite'
const [base='http://127.0.0.1:43844',file='/tmp/ratchet-outbox-recheck.sqlite']=process.argv.slice(2)
const db=new DatabaseSync(file);const ws=JSON.parse(db.prepare('select data from workspace').get().data);db.close();const id=ws.tasks.find(t=>t.title==='Water the plants').id
const browser=await chromium.launch(),c=await browser.newContext({serviceWorkers:'block'}),a=await c.newPage(),b=await c.newPage()
for(const p of [a,b]){await p.goto(base+'/');await p.getByRole('checkbox',{name:'Complete Water the plants'}).waitFor();await p.waitForTimeout(500)}
await a.evaluate(id=>new Promise(resolve=>{const r=indexedDB.open('daythread-outbox',1);r.onsuccess=()=>{const t=r.result.transaction('entries','readwrite');t.objectStore('entries').add({operationId:'held-in-a',owner:'local',action:{type:'task-status',taskId:id,status:'done',today:'2026-11-14'},baseRevision:8,ownRevisions:[],readsBeyond:true,writes:['task:'+id],refs:[id],label:'ticked "Water the plants"',createdAt:Date.now(),state:'held',held:{reason:'changed-since'}});t.oncomplete=()=>resolve()}}),id)
let sends=0;b.on('request',r=>{if(r.url().includes('/_serverFn/cedd5fc6'))sends++})
await b.getByRole('checkbox',{name:'Complete Water the plants'}).click();await b.waitForTimeout(1800)
console.log('B sent while A held:',sends)
assert.equal(sends,0)
await a.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('daythread-outbox',1);r.onsuccess=()=>{const t=r.result.transaction('entries','readwrite'),s=t.objectStore('entries'),q=s.getAll();q.onsuccess=()=>{for(const e of q.result)if(e.operationId==='held-in-a')s.delete(e.seq)};t.oncomplete=()=>resolve()}}))
await b.waitForTimeout(5300);await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await b.waitForTimeout(1800)
console.log('B sends after A discarded:',sends)
console.log('B banner',await b.locator('.banner.save-failed').allTextContents())
await browser.close();assert.equal(sends,1,'after another tab discards the blocker, the dependant must resume on return')
