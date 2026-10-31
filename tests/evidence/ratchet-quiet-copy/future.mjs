import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
for(const [name,engine,width,date] of [['chromium',chromium,1280,'2027-03-02'],['webkit',webkit,390,'2027-03-03']]) {
 const browser=await engine.launch();const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});let creates=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.postData()?.includes('ensure-day'))creates++;});
 await page.goto(`http://127.0.0.1:3680/calendar?date=${date}`);await page.locator('.future-day-trigger').first().waitFor();await page.waitForLoadState('networkidle');
 await page.locator('.future-day-trigger').first().click();await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();assert.equal(creates,0);
 assert.equal(await page.getByText(/Create its page now to plan ahead/).count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(creates,0);if(width===390)await page.locator('[data-slot=alert-dialog-backdrop]').waitFor({state:'detached'});else await page.waitForTimeout(400);
 await page.locator('.future-day-trigger').first().click();await page.getByRole('button',{name:'Create page',exact:true}).click();await page.waitForURL(`**/day/${date}`);await page.locator('.bn-editor').first().waitFor();assert.equal(creates,1);assert.deepEqual(errors,[]);
 console.log('PASS future Calendar prompt Cancel writes nothing/Create opens page',name);await browser.close();
}
