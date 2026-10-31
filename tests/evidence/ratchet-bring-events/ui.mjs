import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]])for(const colorScheme of ['light','dark']) {
 const browser=await engine.launch();const page=await browser.newPage({viewport:{width,height:900},timezoneId:'America/Vancouver',colorScheme,serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});
 for(const date of ['2026-11-01','2026-11-02','2026-11-03','2026-11-04']) {
  await page.goto(`http://127.0.0.1:3682/day/${date}`);await page.locator('.day-event').first().waitFor();await page.waitForLoadState('networkidle');
  const positions=await page.evaluate(()=>{
   const editor=document.querySelector('.bn-editor'),host=editor.querySelector('.event-rows');const r=host.getBoundingClientRect();
   return {eventTop:r.top,eventBottom:r.bottom,labelled:host.classList.contains('is-page-end'),inSection:host.classList.contains('is-in-section'), blocks:[...editor.querySelectorAll('.bn-block-content')].map(n=>({id:n.closest('[data-id]')?.dataset.id,type:n.dataset.contentType,text:n.innerText.trim(),y:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom})),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.ok(!positions.overflow);
  if(date==='2026-11-01'){const carry=positions.blocks.find(n=>n.type==='task'),lastBring=positions.blocks.filter(n=>n.id?.startsWith('brought:')).at(-1),prompt=positions.blocks.find(n=>n.text.includes('Own labelled slot'));assert.ok(carry.bottom<=lastBring.y);assert.ok(lastBring.bottom<=positions.eventTop);assert.ok(positions.eventBottom<=prompt.y);assert.ok(positions.labelled&&positions.inSection);}
  if(date==='2026-11-02'){const brought=positions.blocks.find(n=>n.id?.startsWith('brought:')),prompt=positions.blocks.find(n=>n.text.includes('No heading prompt'));assert.ok(brought.bottom<=positions.eventTop);assert.ok(positions.eventBottom<=prompt.y);assert.ok(positions.inSection);}
  if(date==='2026-11-03'){const heading=positions.blocks.find(n=>n.type==='heading'&&n.text==='Events');if(!heading)console.log('missing heading snapshot',JSON.stringify(positions));assert.ok(heading.bottom<=positions.eventTop);assert.ok(!positions.labelled&&!positions.inSection);}
  if(date==='2026-11-04'){assert.ok(positions.eventBottom<=positions.blocks[0].y);assert.ok(positions.labelled&&positions.inSection);}
  await page.screenshot({path:`tests/evidence/ratchet-bring-events/${name}-${colorScheme}-${date}.png`});console.log('PASS event anchor/order/no overflow',name,colorScheme,date);
 }
 assert.deepEqual(errors,[]);await browser.close();
}
