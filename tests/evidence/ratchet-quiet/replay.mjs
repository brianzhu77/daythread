import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
for(const [name,engine,width,port] of [['chromium',chromium,1280,3678],['webkit',webkit,390,3679]]) {
 const browser=await engine.launch();
 for(const scheme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/pages?view=templates`);await page.waitForSelector('.card-row');await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText(/Day pages start with/).count(),0);
  const row=page.locator('.card-row').first();assert.match(await row.innerText(),/Day\s+Default for day pages/);
  await page.screenshot({path:`tests/evidence/ratchet-quiet/${name}-${scheme}-list.png`});
  if(scheme==='light') {
   let count=0;const bodies=[];let fail=name==='webkit';
   await page.route('**/_serverFn/**',async route=>{
    const req=route.request(),body=req.postData()??'';if(req.method()!=='POST'||!body.includes('create-template'))return route.continue();
    count++;bodies.push(body);await new Promise(r=>setTimeout(r,700));return fail?route.fulfill({status:503,body:'down'}):route.continue();
   });
   await row.click();await page.waitForTimeout(100);assert.ok(await row.isDisabled());assert.match(await row.innerText(),/Opening…/);
   await row.evaluate(e=>e.click());await page.waitForTimeout(150);assert.equal(count,1);
   if(fail){await page.getByRole('button',{name:'Retry',exact:true}).first().waitFor();await page.waitForTimeout(200);assert.ok(await row.isEnabled());fail=false;await row.click();}
   await page.locator('.template-target').waitFor();assert.equal(count,name==='webkit'?2:1);
   if(bodies.length===2){const uuids=/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g;const a=bodies[0].match(uuids),b=bodies[1].match(uuids);assert.equal(a.at(-1),b.at(-1));}
   await page.unroute('**/_serverFn/**');console.log('PASS opening guard and same-page-ID retry',name,count);
  }else {await row.click();await page.locator('.template-target').waitFor();}
  assert.equal(await page.locator('.template-target').inputValue(),'days');assert.equal(await page.getByText(/New pages start from this template|To-dos are copied empty/).count(),0);
  assert.equal(await page.locator('.template-note').count(),1);assert.match(await page.locator('.template-note').innerText(),/Default for:/);
  for(const title of ['TODO','Events','Good Stuffs','Notes'])assert.ok(await page.getByRole('heading',{name:title,exact:true}).isVisible());
  assert.deepEqual(errors,[]);await page.screenshot({path:`tests/evidence/ratchet-quiet/${name}-${scheme}-template.png`});console.log('PASS quiet template list/editor',name,scheme);await context.close();
 }
 await browser.close();
}
