import {chromium,webkit} from '@playwright/test';
let fails=0; const check=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
for(const [name,e] of Object.entries({chromium,webkit})){
const b=await e.launch(); const p=await b.newPage({viewport:{width:1280,height:844}});await p.goto('http://127.0.0.1:43961/tasks?view=open');await p.getByRole('checkbox').first().waitFor();await p.waitForTimeout(500);
const source=await (await p.request.get('http://127.0.0.1:43961/src/components/app-shell.tsx')).text(), modulePath=source.match(/from "([^"\n]*@heroui_react.js[^"\n]*)"/)[1];
await p.evaluate(async url=>{window.rt=(await import(url)).toast;window.actions=0;window.keys=[];},modulePath);
const notice=()=>p.locator('[data-slot="toast"]:not([data-exiting="true"])');
const show=async(label,timeout=1200)=>{await p.evaluate(({label,timeout})=>window.keys.push(window.rt(label,{timeout,actionProps:{children:'Probe action',onPress:()=>window.actions++}})),{label,timeout});await notice().filter({hasText:label}).waitFor();await p.waitForTimeout(300);};
await show('Baseline');await p.waitForTimeout(2200);check(await notice().count()===0,name+' untouched notice expires');await p.evaluate(()=>window.keys.forEach(k=>window.rt.close(k)));await p.waitForTimeout(400);
await show('Outside release');const r=await notice().first().boundingBox();await p.mouse.move(r.x+20,r.y+20);await p.mouse.down();await p.mouse.move(10,100);await p.mouse.up();await p.waitForTimeout(2200);check(await notice().count()===0,name+' pointer released outside does not leave timer paused');
await p.evaluate(()=>window.keys.forEach(k=>window.rt.close(k)));await p.waitForTimeout(400);
await show('Stack A',10000);await show('Stack B',10000);let n=await notice().count();const el=notice().filter({hasText:'Stack B'}),box=await el.boundingBox();await p.mouse.move(box.x+20,box.y+20);await p.mouse.down();await p.mouse.move(box.x+20,box.y-24,{steps:8});await p.mouse.up();await p.waitForTimeout(450);check(await notice().count()===n-1,name+' swiping stacked notice removes only one');
await p.evaluate(()=>window.keys.forEach(k=>window.rt.close(k)));await p.waitForTimeout(400);
await show('Keyboard',10000);await notice().first().locator('.toast__action').focus();await p.keyboard.press('Enter');check(await p.evaluate(()=>window.actions)===1,name+' keyboard action still works');
await b.close();}
process.exitCode=fails?1:0;
