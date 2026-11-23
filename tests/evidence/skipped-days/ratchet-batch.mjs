import {chromium,webkit} from '@playwright/test';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
for(const [name,engine] of Object.entries({chromium,webkit}))for(const batch of ['Apply all','Dismiss']){
 execFileSync(process.execPath,['--no-warnings','tests/evidence/skipped-days/seed.ts','/tmp/ratchet-377.sqlite']);
 const b=await engine.launch();try{const p=await b.newPage({viewport:{width:1280,height:900},timezoneId:'America/Vancouver',serviceWorkers:'block'});await p.goto('http://127.0.0.1:43980');await p.locator('.draft-another').first().waitFor();await wait(600);
 const band=p.locator('.draft-band').filter({has:p.locator('.draft-text',{hasText:/^Kathy homework app$/})});
 await p.route('**/_serverFn/*',r=>r.request().method()==='POST'?r.abort():r.continue());await band.locator('.draft-another').click();await p.locator('.draft-days button').first().click();await wait(150);
 await p.locator('.draft-line button',{hasText:batch}).click();await wait(600);
 const acts=await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('daythread-outbox',1);r.onerror=reject;r.onsuccess=()=>{const d=r.result,q=d.transaction('entries').objectStore('entries').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>x.action));d.close()}}}));
 const moves=acts.filter(x=>x.type==='move-draft'),groups=acts.filter(x=>x.type===(batch==='Dismiss'?'skip-draft':'apply-draft'));
 assert.equal(moves.length,1);assert.equal(groups.length,1);assert(!groups[0].itemIds.includes(moves[0].itemId));
 console.log(name,batch,'PASS pending move excluded from batch',JSON.stringify(acts));
 await p.unroute('**/_serverFn/*');
 }finally{await b.close()}
}
