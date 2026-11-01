import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]]) {
  execFileSync(process.execPath,['tests/evidence/ratchet-slash/seed.ts','--page']);
  const b=await engine.launch();
  const p=await b.newPage({viewport:{width,height:844},serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});
  if(width===390)await p.addInitScript(()=>{
    let up=0;const vv=window.visualViewport;
    Object.defineProperty(vv,'height',{configurable:true,get:()=>innerHeight-up});
    document.addEventListener('focusin',()=>setTimeout(()=>{if(document.activeElement?.closest('[contenteditable=true]')){up=336;vv.dispatchEvent(new Event('resize'));}},60));
  });
  await p.goto('http://127.0.0.1:3691/pages?page=review');
  const first=p.locator('.continuous-editor .bn-inline-content').first();
  await first.click();await p.keyboard.press('End');await p.waitForTimeout(200);await p.keyboard.press('Enter');
  const insert=async()=>{
    await p.keyboard.type('/hr');
    await p.getByRole('option',{name:'Separator',exact:true}).waitFor();
    await p.keyboard.press('Enter');await p.waitForTimeout(400);
  };
  await insert();
  assert.equal(await p.locator('.continuous-editor [data-content-type=divider]').count(),1);
  console.log('ACTIVE',await p.evaluate(()=>({tag:document.activeElement?.outerHTML.slice(0,300),selection:window.getSelection()?.toString()})));
  await p.locator('.continuous-editor .bn-inline-content').last().click();
  await p.keyboard.press('Meta+z');await p.waitForTimeout(1500);
  console.log('UNDO',name,await p.locator('body').innerText());
  await p.screenshot({path:`/tmp/ratchet255-undo-${name}.png`});
  if(await p.locator('.continuous-editor [data-content-type=divider]').count()){await p.keyboard.press('Meta+z');await p.waitForTimeout(800);console.log('SECOND UNDO divider count',await p.locator('.continuous-editor [data-content-type=divider]').count());}
  assert.equal(await p.locator('.continuous-editor [data-content-type=divider]').count(),0,'Undo removes inserted separator');
  await p.keyboard.press('Escape');
  // A fresh line avoids preserving the slash query restored by native Undo.
  await first.click();await p.keyboard.press('End');await p.waitForTimeout(200);await p.keyboard.press('Enter');
  await insert();await p.waitForTimeout(1000);await p.reload();
  await p.locator('.continuous-editor [data-content-type=divider]').waitFor();
  assert.ok((await p.locator('.continuous-editor').innerText()).includes('Own text'));
  console.log('PASS',name,'Separator insertion, Undo, save and reload keep original words');
  for(const trigger of ['[[Target','@']) {
    const line=p.locator('.continuous-editor .bn-inline-content').last();
    await line.click();await p.keyboard.press('End');await p.waitForTimeout(200);await p.keyboard.press('Enter');
    await p.keyboard.type(trigger);await p.locator('#bn-suggestion-menu').waitFor();await p.waitForTimeout(300);
    const rect=await p.locator('#bn-suggestion-menu').boundingBox();
    assert.ok(rect.y>=0 && rect.y+rect.height<=844,'menu fits screen');
    if(width===390){const bar=await p.locator('.editor-phone-toolbar').boundingBox();assert.ok(rect.y+rect.height<=bar.y+1,`${trigger} clear of keyboard toolbar`);}
    await p.screenshot({path:`tests/evidence/ratchet-slash/${name}-${trigger==='@'?'date':'link'}.png`});
    await p.keyboard.press('Escape');for(let i=0;i<trigger.length;i++)await p.keyboard.press('Backspace');
    console.log('PASS',name,trigger,'shared menu fits viewport and simulated keyboard toolbar');
  }
  await b.close();
}
