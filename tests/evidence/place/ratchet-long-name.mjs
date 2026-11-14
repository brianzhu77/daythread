import {chromium} from '@playwright/test';
const b=await chromium.launch();
try{
 const p=await b.newPage();
 await p.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
 await p.goto(`${process.argv[2] ?? 'http://127.0.0.1:43741'}/pages?page=eats`);
 const c=p.locator('[data-cell*="|e3|pl"]').first();await c.waitFor();const box=await c.boundingBox();await p.mouse.click(box.x+box.width-10,box.y+box.height/2);
 const f=p.getByRole('textbox',{name:'Search Where'}); await f.fill('x'.repeat(10001));
 console.log('accepted field length',await f.inputValue().then(x=>x.length),'maxLength',await f.getAttribute('maxlength'));
 await p.getByRole('option').filter({hasText:'Keep “'}).click();
 await p.waitForTimeout(700);
 console.log('after Keep: editor visible',await f.isVisible(),'body tail',(await p.locator('body').innerText()).slice(-250));
}finally{await b.close()}
