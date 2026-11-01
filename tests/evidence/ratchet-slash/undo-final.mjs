import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]])for(const how of ['slash','typed','mid','task','page']){
 execFileSync(process.execPath,['tests/evidence/ratchet-slash/seed.ts','--page',...(how==='mid'?['--mid']:how==='task'?['--task']:[])]);
 const b=await engine.launch();const p=await b.newPage({viewport:{width,height:900},serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:3691/pages?page=review');
 const first=p.locator('.continuous-editor .bn-inline-content').first();await first.waitFor();
 const end=async loc=>{await loc.click();await loc.evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);});await p.waitForTimeout(200);};
 if(how==='mid'||how==='task')await end(p.locator('[data-id=slot] .bn-inline-content'));
 else{await end(first);await p.keyboard.press('Enter');await p.waitForTimeout(300);}
 if(how==='task'){
  await p.keyboard.type('---');await p.waitForTimeout(700);
  assert.equal(await p.locator('[data-id=slot] [data-content-type=task]').count(),1);
  assert.equal(await p.locator('[data-id=slot] .bn-inline-content').textContent(),'---');
  assert.equal(await p.locator('[data-content-type=divider]').count(),0);
 }else if(how==='page'){
  await p.keyboard.type('/page');await p.getByRole('option',{name:'Page',exact:true}).waitFor();await p.keyboard.press('Enter');await p.waitForTimeout(900);
  assert.notEqual(new URL(p.url()).searchParams.get('page'),'review');
  await p.goto('http://127.0.0.1:3691/pages?page=review');await p.locator('[data-content-type=pageLink]').waitFor();
  assert.ok((await p.locator('.continuous-editor').innerText()).includes('Own text'));
 }else{
  if(how==='typed')await p.keyboard.type('---');else{await p.keyboard.type('/hr');await p.getByRole('option',{name:'Separator',exact:true}).waitFor();await p.keyboard.press('Enter');}
  await p.waitForTimeout(650);assert.equal(await p.locator('[data-content-type=divider]').count(),1);
  const caret=await p.evaluate(()=>{const s=getSelection();const e=s.anchorNode.nodeType===3?s.anchorNode.parentElement:s.anchorNode;const b=e.closest('.bn-block-outer');return {type:b.querySelector('[data-content-type]').dataset.contentType,text:b.textContent,prev:b.previousElementSibling?.querySelector('[data-content-type]')?.dataset.contentType};});
  assert.deepEqual(caret,{type:'paragraph',text:'',prev:'divider'});
  if(how==='mid')assert.equal((await p.locator('.bn-block-outer[data-id=next] .bn-inline-content').textContent()),'Untouched heading');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(600);assert.equal(await p.locator('[data-content-type=divider]').count(),0,'one Undo removes divider');
  if(how==='typed')assert.ok((await p.locator('.continuous-editor').innerText()).includes('---'));
  await p.keyboard.press('Meta+Shift+z');await p.waitForTimeout(600);assert.equal(await p.locator('[data-content-type=divider]').count(),1,'one Redo restores divider');
  await p.waitForTimeout(600);await p.reload();await p.locator('[data-content-type=divider]').waitFor();assert.ok((await p.locator('.continuous-editor').innerText()).includes('Own text'));
 }
 assert.deepEqual(errors,[]);console.log('PASS',name,how);await b.close();
}
