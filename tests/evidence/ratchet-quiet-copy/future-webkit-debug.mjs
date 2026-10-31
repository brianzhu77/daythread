import {webkit} from '@playwright/test';
const browser=await webkit.launch();const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});page.setDefaultTimeout(8000);
await page.goto('http://127.0.0.1:3680/calendar?date=2027-04-02');await page.waitForLoadState('networkidle');await page.locator('.future-day-trigger').first().tap();await page.waitForTimeout(700);
console.log('open',await page.locator('[data-slot=alert-dialog-backdrop]').evaluateAll(es=>es.map(e=>e.outerHTML.slice(0,260))));
await page.getByRole('button',{name:'Cancel',exact:true}).tap();await page.waitForTimeout(1000);
console.log('after cancel',await page.locator('[data-slot=alert-dialog-backdrop]').evaluateAll(es=>es.map(e=>e.outerHTML.slice(0,260))));
await page.locator('.future-day-trigger').first().tap();await page.waitForTimeout(700);await page.getByRole('button',{name:'Create page',exact:true}).tap();await page.waitForURL('**/day/2027-04-02');console.log('PASS WebKit touch cancel/reopen/create');await browser.close();
