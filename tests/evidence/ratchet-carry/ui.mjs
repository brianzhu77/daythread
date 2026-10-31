import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await webkit.launch();const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Vancouver',isMobile:true,hasTouch:true,serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});
await page.goto('http://127.0.0.1:3682/day/2026-11-01');await page.locator('.editor-task').first().waitFor();await page.waitForLoadState('networkidle');
assert.equal(await page.locator('.editor-task').count(),4);assert.equal(await page.locator('.editor-task[data-draft=true]').count(),2);assert.equal(await page.locator('[data-content-type=divider]').count(),2);
const first=await page.locator('.bn-editor [data-content-type]').evaluateAll(nodes=>nodes.filter(n=>n.closest('.bn-editor')===document.querySelector('.bn-editor')).map(n=>({type:n.dataset.contentType,text:n.querySelector('.editor-task-title')?.textContent??n.innerText})).slice(0,7));
assert.equal(first[0].type,'heading');assert.equal(first[1].type,'task');assert.equal(first[2].type,'task');assert.equal(first[3].type,'paragraph');assert.equal(first[4].type,'task');
assert.deepEqual(errors,[]);await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:'/tmp/ratchet245-backup-top.png'});await page.screenshot({path:'/tmp/ratchet245-backup-full.png',fullPage:true});console.log('PASS backup WebKit390 at Nov1: heading/carry/carry/prompt/empty slot; 2dividers/2empty slots; no page errors');await browser.close();
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]]) {
 const browser=await engine.launch();const images=[];
 for(const [tag,port] of [['old',3684],['new',3683]]) {
  const page=await browser.newPage({viewport:{width,height:900},timezoneId:'America/Vancouver',serviceWorkers:'block'});await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});await page.goto(`http://127.0.0.1:${port}/day/2026-11-01`);await page.locator('.editor-task').first().waitFor();await page.waitForLoadState('networkidle');await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(0,0);await page.waitForTimeout(400);
  const shot=await page.locator('.bn-editor').first().screenshot();fs.writeFileSync(`tests/evidence/ratchet-carry/builtin-${name}-${tag}.png`,shot);images.push(shot);await page.close();
 }
 assert.equal(Buffer.compare(...images),0);console.log('PASS built-in page before/after pixels identical',name,width);await browser.close();
}
