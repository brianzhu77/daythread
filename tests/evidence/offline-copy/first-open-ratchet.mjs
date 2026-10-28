import{chromium}from'@playwright/test';
const b=await chromium.launch(),c=await b.newContext(),p=await c.newPage();await p.goto('http://127.0.0.1:3571/');await p.locator('.bn-editor').waitFor();await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await p.waitForTimeout(1000);
console.log('after first successful open',await p.evaluate(async()=>Object.fromEntries(await Promise.all((await caches.keys()).map(async k=>[k,(await(await caches.open(k)).keys()).map(x=>new URL(x.url).pathname)])))));
await c.setOffline(true);await p.reload();console.log('offline first reopen body',await p.locator('body').innerText());await b.close();
