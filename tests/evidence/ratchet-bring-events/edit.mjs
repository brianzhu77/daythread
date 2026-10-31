import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
import {pageNodes,inlineText} from '../../../src/domain/editor-document.ts';
const repo=new SqliteWorkspaceRepository('/tmp/ratchet246.sqlite');
for(const [name,engine,width] of [['webkit',webkit,390],['chromium',chromium,1280]]) {
 const browser=await engine.launch();const page=await browser.newPage({viewport:{width,height:900},timezoneId:'America/Vancouver',serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});
 await page.goto('http://127.0.0.1:3682/day/2026-11-01');await page.locator('.day-event').waitFor();const gap=await page.evaluate(()=>{const chip=document.querySelector('.event-rows .line-ref').getBoundingClientRect();const p=[...document.querySelectorAll('.bn-block-content')].find(n=>n.dataset.contentType==='paragraph'&&n.innerText.includes('Own labelled slot'));const range=document.createRange();range.selectNodeContents(p.querySelector('.bn-inline-content'));return range.getBoundingClientRect().top-chip.bottom;});assert.ok(gap>=10);console.log('PASS mid-section event-to-prompt gap',name,gap);
 await page.goto('http://127.0.0.1:3682/day/2026-11-04');await page.locator('.day-event').waitFor();await page.waitForLoadState('networkidle');const p=page.locator('.bn-block-content[data-content-type=paragraph]',{hasText:'No heading prompt'}).first();await p.click();await page.keyboard.press('End');await page.waitForTimeout(180);await page.keyboard.type(' edited');await page.waitForTimeout(1200);
 const nodes=pageNodes((await repo.load()).pages.find(p=>p.date==='2026-11-04'));assert.equal(nodes.length,2);assert.ok(inlineText(nodes[0].content).includes('edited'));assert.deepEqual(nodes.map(n=>n.type),['paragraph','bulletListItem']);assert.equal(await page.locator('.day-event').count(),1);assert.deepEqual(errors,[]);console.log('PASS top-of-page decoration survives editing without entering stored document',name);await browser.close();
}
