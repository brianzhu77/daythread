import {chromium} from '@playwright/test';
const b=await chromium.launch();
try {
 const p=await b.newPage();
 await p.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
 await p.goto(`${process.argv[2] ?? 'http://127.0.0.1:43741'}/pages?page=eats`);
 const c=p.locator('[data-cell*="|e3|pl"]').first();await c.waitFor();const box=await c.boundingBox();await p.mouse.click(box.x+box.width-10,box.y+box.height/2);
 const f=p.getByRole('textbox',{name:'Search Where'});await f.waitFor();
 await p.getByRole('option').filter({hasText:'Use current location'}).click();
 await f.fill('京');await p.waitForTimeout(400);
 console.log('after typing cancels location:',await p.getByRole('option').filter({hasText:'Use current location'}).innerText());
}finally{await b.close()}
