import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
import { DatabaseSync } from 'node:sqlite'
const base='http://127.0.0.1:3377', dbPath='/tmp/rb-leave/w.sqlite'; const b=await chromium.launch();let failures=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const check=(ok,name,detail)=>{console.log(ok?'PASS':'FAIL',name,detail??'');if(!ok)failures++};
const dbText=()=>{const d=new DatabaseSync(dbPath,{readOnly:true});try{return d.prepare("select editorJSON from pages where snapshot='current' and date='2026-10-18'").get().editorJSON}finally{d.close()}};
const open=async()=>{const c=await b.newContext({viewport:{width:1280,height:1000}});const p=await c.newPage();p.on('pageerror',e=>check(false,'pageerror',e.message));await p.goto(base+'/day/2026-10-18',{waitUntil:'networkidle'});await sleep(600);return {c,p}};
const add=async(p,s)=>{const l=p.locator('.continuous-editor .bn-inline-content').filter({hasText:'DRIVE Basketball'}).first();await l.click();await p.keyboard.press('Meta+ArrowRight');await p.keyboard.type(s)};
const go=async(p,date)=>p.locator(`a[href="/day/${date}"]`).first().click();
// Hold the first autosave before the server sees it. Type more and leave while that save is in flight.
{
const {c,p}=await open();let release,seen;const arrived=new Promise(r=>seen=r), gate=new Promise(r=>release=r);let held=false;
await p.route('**/_serverFn/**',async r=>{if(r.request().method()==='POST'&&!held){held=true;seen();await gate}await r.continue()});
await add(p,' [R99A]');await arrived;await add(p,' [R99B]');await go(p,'2026-10-21');release();await sleep(2300);
check(dbText().includes('[R99A]')&&dbText().includes('[R99B]'),'inflight then more input then leave persists both');await go(p,'2026-10-18');await sleep(900);check(!/draft kept|Changed in another tab|Recovered/.test(await p.locator('.editor-save-line').innerText()),'return after settled save is clean',await p.locator('.editor-save-line').innerText());await c.close();
}
// Leave-save held; reopen and type newer words before the old editor's request completes.
{
const {c,p}=await open();let release,seen;const arrived=new Promise(r=>seen=r),gate=new Promise(r=>release=r);let held=false;
await p.route('**/_serverFn/**',async r=>{if(r.request().method()==='POST'&&!held){held=true;seen();await gate}await r.continue()});
await add(p,' [R99LEAVE]');await go(p,'2026-10-21');await arrived;await go(p,'2026-10-18');await add(p,' [R99NEW]');release();await sleep(2600);
const st=await p.locator('.editor-save-line').innerText();const stash=await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('daythread:editor:')));
check((dbText().includes('[R99NEW]')||stash.some(([,v])=>v.includes('[R99NEW]')))&& (await p.locator('.continuous-editor').innerText()).includes('[R99NEW]'),'old leave save cannot clear newer returned draft',st);
console.log('RETURN_STATUS',st,'NEW_IN_DB',dbText().includes('[R99NEW]'),'NEW_STASH',stash.some(([,v])=>v.includes('[R99NEW]')));
if(await p.getByRole('button',{name:'Load latest'}).count()){await p.getByRole('button',{name:'Load latest'}).click();await sleep(1800);check(dbText().includes('[R99NEW]')&&dbText().includes('[R99LEAVE]'),'return-race Load latest saves all words')};await c.close();
}
// Slow first save exceeds the five-second leave wait, while additional text is pending.
{
const {c,p}=await open();let release,seen;const arrived=new Promise(r=>seen=r),gate=new Promise(r=>release=r);let held=false;
await p.route('**/_serverFn/**',async r=>{if(r.request().method()==='POST'&&!held){held=true;seen();await gate}await r.continue()});
await add(p,' [R99SLOWA]');await arrived;await add(p,' [R99SLOWB]');await go(p,'2026-10-21');await sleep(5800);release();await sleep(2000);
const stash=await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('daythread:editor:')));
console.log('SLOW_A_DB',dbText().includes('[R99SLOWA]'),'SLOW_B_DB',dbText().includes('[R99SLOWB]'),'SLOW_B_STASH',stash.some(([,v])=>v.includes('[R99SLOWB]')));
check(dbText().includes('[R99SLOWB]'),'save slower than five seconds still saves later input on leave');await c.close();
}
await b.close();console.log('failures',failures);process.exitCode=failures?1:0;
