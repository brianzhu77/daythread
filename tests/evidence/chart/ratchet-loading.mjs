import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3737';const chunk=/\/assets\/database-chart-[\w-]+\.js$/;
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();let chunks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route(chunk,r=>{chunks++;return r.abort()});
 await page.goto(base+'/pages?page=chart-review');await page.locator('.database-chart-unavailable').nth(1).waitFor();
 assert.equal(chunks,1);assert.equal(await page.locator('.database-chart-unavailable').count(),2);
 const line=page.locator('.bn-block-outer[data-id="before"] .bn-inline-content').first();await line.click();await page.keyboard.press('End');await page.keyboard.type(' unsaved-'+name);
 // Cut off command writes, leaving local drafts intact. Reload must not happen.
 await context.route('**/*',route=>route.request().method()==='POST'?route.abort():route.fallback());
 let nav=0;page.on('framenavigated',f=>{if(f===page.mainFrame())nav++});
 await page.locator('.database-chart-unavailable button').first().click();await page.waitForTimeout(1200);
 assert.equal(nav,0);assert.match(await page.locator('.bn-editor').first().innerText(),new RegExp('unsaved-'+name));
 console.log('PASS',name,'shared failed import and failed save prevent reload',JSON.stringify({chunks,nav,errors}));
 await context.unroute('**/*');await context.unroute(chunk);
 await Promise.all([page.waitForEvent('load'),page.locator('.database-chart-unavailable button').first().click()]);
 await page.locator('.database-chart').nth(1).waitFor();
 assert.match(await page.locator('.bn-editor').first().innerText(),new RegExp('unsaved-'+name));
 console.log('PASS',name,'successful save then reload preserves words and both charts return');
 await browser.close();
}
