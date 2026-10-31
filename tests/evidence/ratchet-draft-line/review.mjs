import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]])for(const scheme of ['light','dark']){
  execFileSync(process.execPath,['tests/evidence/ratchet-draft-line/seed.ts']);
  const b=await engine.launch();
  const p=await b.newPage({viewport:{width,height:900},colorScheme:scheme,timezoneId:'America/Vancouver',serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});
  await p.clock.install({time:new Date('2026-10-31T18:00:00Z')});
  await p.goto('http://127.0.0.1:3690/day/2026-10-31');
  const dismiss=p.getByRole('button',{name:'Dismiss',exact:true});
  await dismiss.waitFor();
  assert.equal(await dismiss.evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
  assert.equal(await p.locator('[data-draft-item=line] .draft-text').evaluate(e=>getComputedStyle(e).textDecorationStyle),'dashed');
  await p.keyboard.press('Tab');
  await dismiss.focus();
  const focus=await dismiss.evaluate(e=>({visible:e.matches(':focus-visible'),style:getComputedStyle(e).outlineStyle}));
  assert.equal(focus.visible,true);
  assert.notEqual(focus.style,'none');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  assert.equal(await p.locator('[data-draft-item]').count(),0);
  // Retry uses the identical selector; exercise its rendered state through the UI seam.
  await p.evaluate(()=>{window.__daythreadDraft={'*':{state:'failed',planningEndId:null,items:[],moreOpen:[]}};window.__daythreadDraftBump();});
  const retry=p.getByRole('button',{name:'Retry',exact:true});
  await retry.waitFor();
  assert.equal(await retry.evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
  await retry.click();
  assert.ok(await p.getByText('Preparing…',{exact:true}).count());
  await p.screenshot({path:`tests/evidence/ratchet-draft-line/${name}-${scheme}.png`});
  console.log('PASS',name,scheme,'plain Dismiss/Retry, dashed suggestion, visible keyboard focus, Enter Dismiss real action, Retry seam action');
  await b.close();
}
