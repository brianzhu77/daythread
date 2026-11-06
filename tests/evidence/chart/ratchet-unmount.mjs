// Run after ratchet-seed.ts on the same throwaway store and built preview at 3737.
import {chromium,webkit} from '@playwright/test';import assert from 'node:assert/strict';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});const c=await browser.newContext({serviceWorkers:'block'});const page=await c.newPage();const errors=[];let release;const gate=new Promise(r=>release=r);let asked=0;
 await c.route(/\/assets\/database-chart-[\w-]+\.js$/,async r=>{asked++;await gate;await r.continue()});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3737/pages?page=chart-review');await page.locator('.database-chart-loading').nth(1).waitFor();
 await page.locator('a[href="/"]').first().click();await page.waitForURL('http://127.0.0.1:3737/');release();await page.waitForTimeout(500);
 assert.equal(errors.length,0);assert.equal(await page.locator('.database-chart').count(),0);assert.equal(asked,1);
 // Browser back uses app history and the already loaded module, no second import.
 await page.goBack();await page.locator('.database-chart').nth(1).waitFor();assert.equal(asked,1);assert.equal(errors.length,0);
 console.log('PASS',name,'unmount while loading then back uses one import and no page errors');await browser.close();
}
