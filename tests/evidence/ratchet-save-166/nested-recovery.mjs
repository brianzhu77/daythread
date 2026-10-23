import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
const base=process.argv[2]??'http://127.0.0.1:3550',marker='OFFLINE_NESTED_CHILD_'+Date.now();
const b=await chromium.launch(),ctx=await b.newContext(),a=await ctx.newPage();
try{
 await a.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});
 await a.route('**/_serverFn/**',r=>r.request().method()==='POST'?r.abort('failed'):r.continue());
 const box=await a.locator('.bn-block-outer[data-id="parent"] .bn-inline-content').first().boundingBox();await a.mouse.click(box.x+box.width-3,box.y+box.height/2);console.log(JSON.stringify({selection:await a.evaluate(()=>({text:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset}))}));await a.keyboard.press('Enter');await a.keyboard.press('Tab');await a.keyboard.type(marker);await a.waitForTimeout(800);
 const stored=await a.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('daythread:editor:')).map(([k,v])=>JSON.parse(v)));console.log(JSON.stringify({draftParents:stored.map(s=>JSON.parse(s.document).find(n=>n.id==='parent'))}));
 const nested=await a.locator('.bn-block-outer[data-id="parent"]').first().innerText();assert.ok(nested.includes(marker),'actual new child is nested under original parent');
 await a.close({runBeforeUnload:true});const fresh=await ctx.newPage();await fresh.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});await fresh.waitForTimeout(2000);
 const recovered=(await fresh.locator('.bn-editor').innerText()).includes(marker);const slots=await fresh.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('daythread:editor:')).map(([k,v])=>({key:k,document:JSON.parse(v).document,claimedBy:JSON.parse(v).claimedBy})));
 console.log(JSON.stringify({nestedBeforeClose:true,recovered,retainedInSlot:slots.some(s=>s.document.includes(marker)),claimed:slots.filter(s=>s.claimedBy).length}));assert.ok(recovered,'unsaved child must survive orphan recovery under unchanged parent');
}finally{await b.close()}
