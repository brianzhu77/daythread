import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await webkit.launch();const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Vancouver',isMobile:true,hasTouch:true,serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});
await page.goto('http://127.0.0.1:3682/day/2026-11-01');await page.locator('.editor-task').first().waitFor();await page.waitForLoadState('networkidle');
await page.getByRole('button',{name:'Add all tasks',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.locator('.editor-task').count(),4);assert.equal(await page.locator('.editor-task[data-draft=true]').count(),2);assert.equal(await page.locator('[data-content-type=divider]').count(),2);
const first=await page.locator('.bn-editor [data-content-type]').evaluateAll(nodes=>nodes.filter(n=>n.closest('.bn-editor')===document.querySelector('.bn-editor')).map(n=>({type:n.dataset.contentType,text:n.querySelector('.editor-task-title')?.textContent??n.innerText})).slice(0,7));
assert.equal(first[0].type,'heading');assert.equal(first[1].type,'task');assert.equal(first[2].type,'task');assert.equal(first[3].type,'paragraph');assert.equal(first[4].type,'task');
assert.deepEqual(errors,[]);await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:'/tmp/ratchet245-backup-top.png'});await page.screenshot({path:'/tmp/ratchet245-backup-full.png',fullPage:true});console.log('PASS backup WebKit390 at Nov1: heading/carry/carry/prompt/empty slot; 2dividers/2empty slots; no page errors');await browser.close();
