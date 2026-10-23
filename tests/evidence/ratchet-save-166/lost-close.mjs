import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {DatabaseSync} from 'node:sqlite'
const [base='http://127.0.0.1:3550',db='/tmp/ratchet-155-b35-166-v2.sqlite']=process.argv.slice(2);
const copies=s=>{const d=new DatabaseSync(db,{readOnly:true});try{return d.prepare("SELECT editorJSON FROM pages WHERE snapshot='current'").all().reduce((n,r)=>n+String(r.editorJSON??'').split(s).length-1,0)}finally{d.close()}};
const b=await chromium.launch();
for(const variant of ['normal','whitespace','emptyline']){
 const ctx=await b.newContext(),p=await ctx.newPage();await p.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});await p.waitForTimeout(300);
 const marker='LOST_CLOSE_'+variant;let resolve;const applied=new Promise(r=>resolve=r);let dropped=false;
 await p.route('**/_serverFn/**',async r=>{if(r.request().method()==='POST'&&!dropped){dropped=true;await r.fetch();await r.abort('failed');resolve()}else await r.continue()});
 await p.locator('.bn-block-outer[data-id="parent"] .bn-inline-content').first().click();await p.keyboard.press('Meta+ArrowRight');await p.keyboard.press('Enter');await p.keyboard.type(marker+(variant==='whitespace'?'   ':''));if(variant==='emptyline')await p.keyboard.press('Enter');await applied;
 await p.close({runBeforeUnload:true});const q=await ctx.newPage();await q.goto(base+'/pages?page=ratchet-writing',{waitUntil:'networkidle'});await q.waitForTimeout(2000);
 const count=copies(marker);console.log(JSON.stringify({variant,count,status:await q.locator('.editor-save-line').innerText()}));assert.equal(count,1);await ctx.close();
}
await b.close();
