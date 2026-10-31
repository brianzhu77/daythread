import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
for (const [name, engine, width] of [['chromium', chromium, 1280], ['webkit', webkit, 390]]) {
 const browser = await engine.launch();
 for (const preview of [true, false]) for (const colorScheme of ['light','dark']) {
  const context = await browser.newContext({viewport:{width,height:900},colorScheme,serviceWorkers:'block'});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${preview?3672:3673}/`); await page.waitForSelector('.day-head'); await page.waitForTimeout(800);
  assert.equal(await page.title(),preview?'Daythread Preview':'Daythread');
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'),preview?'/manifest-preview.webmanifest':'/manifest.webmanifest');
  assert.equal(await page.locator('.brand-preview').count(),preview?1:0);
  assert.equal(await page.locator('.preview-note').isVisible(),preview && width===390);
  assert.equal(await page.evaluate(()=>localStorage.getItem('daythread.preview')),preview?'1':'0');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`tests/evidence/ratchet-preview/${name}-${preview}-${colorScheme}.png`});
  for (const stored of ['1','0']) {
   let aborted=0; await page.route('**/_serverFn/**',route=>{aborted++;return route.abort();});
   await page.evaluate(value=>localStorage.setItem('daythread.preview',value),stored);
   await page.evaluate(()=>window.__TSR_ROUTER__.invalidate()); await page.waitForTimeout(600);
   assert.ok(aborted>0); assert.equal(await page.locator('.brand-preview').count(),stored==='1'?1:0);
   assert.equal(await page.title(),stored==='1'?'Daythread Preview':'Daythread');
   await page.unroute('**/_serverFn/**');
  }
  console.log('PASS visual/runtime/fallback',name,preview,colorScheme); await context.close();
 }
 await browser.close();
}
const browser=await chromium.launch();
for (const width of [390,1280]) {
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
 await page.goto('http://127.0.0.1:3672/');await page.waitForSelector('.day-head');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForSelector('.day-head');
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.waitForTimeout(1000);
 assert.ok(await page.evaluate(async()=>!!await caches.match(location.origin+'/')));
 await context.setOffline(true); const cold=await context.newPage();const errors=[];cold.on('pageerror',e=>errors.push(e.message));
 await cold.goto('http://127.0.0.1:3672/');await cold.waitForSelector('.day-head');await cold.waitForTimeout(800);
 assert.equal(await cold.title(),'Daythread Preview');assert.equal(await cold.locator('.brand-preview').count(),1);assert.deepEqual(errors,[]);
 console.log('PASS cold new-tab offline cached SSR',width);await context.close();
}
await browser.close();
