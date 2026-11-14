import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {harness,today} from '../../v2-helpers.ts'
import {capture} from '../../../src/components/outbox.ts'
const h=harness();h.day(today)
const a=capture(h.ws,{type:'create-database',pageId:'newdb',title:'New DB',homeBlockId:null},'a',false)
const b=capture(a.predicted,{type:'add-row',databaseId:'newdb',pageId:'newrow',title:'Original',values:{},at:new Date().toISOString()},'b',false)
const c=capture(b.predicted,{type:'rename-page',pageId:'newrow',title:'Edited'},'c',false)
const entries=[a,b,c].map((v,i)=>({...v.entry,owner:'local',baseRevision:9,ownRevisions:[],createdAt:Date.now()+i,state:i===0?'held':'pending',...(i===0?{held:{reason:'conflict'}}:{})}))
const browser=await chromium.launch(),ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage()
await p.goto(process.argv[2]??'http://127.0.0.1:43845/');await p.getByRole('checkbox',{name:'Complete Water the plants'}).waitFor();await p.waitForTimeout(700)
await p.evaluate(es=>new Promise((resolve,reject)=>{const r=indexedDB.open('daythread-outbox',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('entries',{keyPath:'seq',autoIncrement:true});s.createIndex('owner','owner')};r.onsuccess=()=>{const t=r.result.transaction('entries','readwrite');t.objectStore('entries').clear();for(const e of es)t.objectStore('entries').add(e);t.oncomplete=()=>{localStorage.setItem('daythread:outbox:stored','1');resolve()};t.onabort=()=>reject(t.error)}}),entries)
const sent=[];p.on('request',r=>{if(r.url().includes('/_serverFn/cedd5fc6'))sent.push(r.postData())})
await p.reload();await p.waitForTimeout(3000)
const left=await p.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('daythread-outbox',1);r.onsuccess=()=>{const q=r.result.transaction('entries').objectStore('entries').getAll();q.onsuccess=()=>resolve(q.result)}}))
console.log('Entries',left.map(e=>({operationId:e.operationId,state:e.state,held:e.held})));console.log('Sends',sent);await browser.close();assert.equal(sent.length,0,'neither the direct nor transitive dependant may be sent before its held ancestor')
