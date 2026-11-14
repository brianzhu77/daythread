import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const browser=await chromium.launch(); const ctx=await browser.newContext({serviceWorkers:'block'}); const a=await ctx.newPage(),b=await ctx.newPage();
const base=process.argv[2] ?? 'http://127.0.0.1:43844'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
for(const p of [a,b]){await p.goto(base+'/');await p.getByRole('checkbox',{name:'Complete Water the plants'}).waitFor();await wait(500)}
let release; const gate=new Promise(r=>release=r); await a.route('**/_serverFn/cedd5fc6*',async route=>{await gate;await route.continue()});
await a.getByRole('checkbox',{name:'Complete Water the plants'}).click();await wait(700);
await b.getByRole('checkbox',{name:'Complete Water the plants'}).click();await wait(800);
await b.getByRole('checkbox',{name:'Complete Water the plants'}).click();await wait(400);
release();await wait(3500);
const banners=await b.locator('.banner.save-failed').allTextContents(); console.log('B held banners',banners);
console.log('IDB',await b.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('daythread-outbox',1);r.onsuccess=()=>{const q=r.result.transaction('entries').objectStore('entries').getAll();q.onsuccess=()=>resolve(q.result)}})));
const checked=await b.getByRole('checkbox',{name:'Complete Water the plants'}).isChecked(); await browser.close(); assert.deepEqual(banners,[], 'same-device predecessors must not create a false conflict'); assert.equal(checked,false,'the final untick must be applied');
