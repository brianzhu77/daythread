import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
const browser=await chromium.launch(),c=await browser.newContext({serviceWorkers:'block'});await c.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined}));const p=await c.newPage()
await p.goto(process.argv[2]??'http://127.0.0.1:43844/');await p.getByRole('checkbox',{name:'Complete Water the plants'}).waitFor();await p.waitForTimeout(1000)
let failed=false;await p.route('**/_serverFn/**',async r=>{if(r.request().method()==='POST'&&!failed){failed=true;await r.abort('internetdisconnected')}else await r.continue()})
await p.getByRole('checkbox',{name:'Complete Water the plants'}).click();await p.waitForTimeout(700)
const before=await p.getByText('Not saved on this device',{exact:false}).count()
await p.getByRole('checkbox',{name:'Complete Call the bank'}).click();await p.waitForTimeout(1500)
const after=await p.getByText('Not saved on this device',{exact:false}).count();const leave=await p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})
console.log({before,after,leave});await browser.close();assert.equal(after,1,'unrelated success must not dismiss the warning for an unsent failed operation');assert.equal(leave,true)
