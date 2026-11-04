import * as pw from '@playwright/test';import {execFileSync} from 'node:child_process';import {rmSync} from 'node:fs'
const base='http://127.0.0.1:3698',store='/tmp/ratchet121.sqlite',wait=ms=>new Promise(r=>setTimeout(r,ms));const b=await pw[process.argv[2]??'chromium'].launch();let failed=0
const state=()=>execFileSync('sqlite3',[store,'select data from workspace']).toString()
for(const mode of ['host-save-then-peek','peek-save-then-host']){
 for(const suffix of ['', '-wal','-shm'])rmSync(store+suffix,{force:true});execFileSync('node',['--no-warnings','tests/evidence/peek/seed-synced.ts',store]);execFileSync('node',['--no-warnings','tests/evidence/ratchet-side-peek/side.ts',store]);const c=await b.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.stack??e.message));await p.goto(base+'/pages?page=books');await p.locator('.synced-label-button').first().waitFor();await wait(800)
 const host=p.locator('.doc-screen').first(),peek=p.locator('.peek');const type=async(scope,words)=>{await scope.locator('.bn-inline-content',{hasText:'Shared words'}).first().click();await p.keyboard.press('Meta+ArrowRight');await wait(180);await p.keyboard.type(words)}
 const open=async()=>{await p.locator('tr[data-row=dune]').hover();await p.locator('tr[data-row=dune] .database-open').click();await peek.waitFor();await wait(700)}
 let release,seen;const held=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);let once=false
 await p.route('**/_serverFn/**',async r=>{if(!once&&r.request().method()==='POST'&&(r.request().postData()??'').includes('save-editor')){once=true;seen();await held}await r.continue().catch(()=>{})})
 if(mode==='host-save-then-peek'){await type(host,' HOST');await arrived;await open();await type(peek,' PEEK');release()}
 else{await open();await type(peek,' PEEK');await arrived;await type(host,' HOST');release()}
 await wait(5500);const snapshot=state(),shown=await p.locator('.bn-inline-content').allInnerTexts();const ok=snapshot.includes('HOST')&&snapshot.includes('PEEK')&&errors.length===0;if(!ok)failed++;console.log(ok?'PASS':'FAIL',mode,JSON.stringify({shown,wordsStored:{host:snapshot.includes('HOST'),peek:snapshot.includes('PEEK')},notice:await p.locator('[role=alert],[role=status]').allInnerTexts(),errors}));await c.close()
}
await b.close();process.exit(failed?1:0)
