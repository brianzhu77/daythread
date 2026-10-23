import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
const base=process.argv[2]??'http://127.0.0.1:3564';
const tag=Date.now(), markerA='OPENER_A_'+tag,markerB='OPENER_B_'+tag;
const b=await chromium.launch(),c=await b.newContext(),a=await c.newPage();
await a.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});
const first=await a.evaluate(()=>sessionStorage.getItem('daythread.tab'));
const popup=c.waitForEvent('page');await a.evaluate(()=>window.open('/pages?page=ratchet-writing','_blank'));const d=await popup;await d.waitForLoadState('networkidle');
const second=await d.evaluate(()=>sessionStorage.getItem('daythread.tab'));
for(const [p,text] of [[a,markerA],[d,markerB]]){
 await p.route('**/_serverFn/**',r=>r.request().method()==='POST'?r.abort('failed'):r.continue());
 await p.locator('.bn-block-outer[data-id="parent"] .bn-inline-content').first().click();await p.keyboard.press('Meta+ArrowRight');await p.keyboard.press('Enter');await p.keyboard.type(text);await p.waitForTimeout(800);
}
const slots=await d.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('daythread:editor:')).map(([key,value])=>({key,value:JSON.parse(value)})));
console.log(JSON.stringify({first,second,same:first===second,slots:slots.map(s=>({key:s.key,hasA:s.value.document.includes(markerA),hasB:s.value.document.includes(markerB)}))}));
await a.close({runBeforeUnload:true});await d.close({runBeforeUnload:true});const fresh=await c.newPage();await fresh.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});await fresh.waitForTimeout(2000);const text=await fresh.locator('.bn-editor').innerText();const recoveredA=text.includes(markerA),recoveredB=text.includes(markerB);console.log(JSON.stringify({recoveredA,recoveredB}));await b.close();assert.notEqual(first,second,'two live opener tabs need distinct recovery identities');assert.ok(recoveredA&&recoveredB,'both drafts must survive');
