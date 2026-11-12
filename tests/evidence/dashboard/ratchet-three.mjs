import {chromium,webkit} from '@playwright/test'
const base=process.argv[2];let fail=0;
for(const [name,engine] of Object.entries({chromium,webkit})){
 const b=await engine.launch();try{
 const p=await (await b.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'})).newPage();
 const ok=(v,s,d={})=>{console.log(`${v?'PASS':'FAIL'} ${name} ${s} ${JSON.stringify(d)}`);if(!v)fail++};
 await p.goto(base+'/pages?page=home');await p.locator('.dashboard-widget').first().waitFor();await p.locator('.dashboard-edit').click();
 await p.locator('.dashboard-widget-more').first().click();await p.getByRole('menuitem',{name:'Duplicate',exact:true}).click();await p.waitForTimeout(300);
 const row=p.locator('.dashboard-row[data-row]').first();const values=()=>row.locator(':scope > .dashboard-widget').evaluateAll(es=>es.map(e=>Number(e.style.getPropertyValue('--widget-width'))));
 const handle=row.locator('.dashboard-split').first();await handle.focus();await p.keyboard.press('ArrowRight');await p.waitForTimeout(250);ok(JSON.stringify(await values())==='[6,3,3]','right key grows left widget in whole row',await values());
 await p.keyboard.press('ArrowLeft');await p.waitForTimeout(250);ok(JSON.stringify(await values())==='[4,4,4]','left key returns through equal split',await values());
 await p.keyboard.press('ArrowLeft');await p.waitForTimeout(250);ok(JSON.stringify(await values())==='[3,6,3]','next left key grows middle widget',await values());
 await p.keyboard.press('ArrowRight');await p.waitForTimeout(250);
 const box=await row.boundingBox(),h=await handle.boundingBox();await p.mouse.move(h.x+h.width/2,h.y+70);await p.mouse.down();await p.mouse.move(box.x+box.width/2,h.y+70,{steps:5});await p.waitForTimeout(150);
 ok(JSON.stringify(await values())==='[6,3,3]'&&await p.locator('.dashboard-badge').innerText()==='1/2 · 1/4 · 1/4','pointer previews all three widths and badge',await values());
 await p.keyboard.press('Escape');await p.mouse.up();await p.waitForTimeout(150);ok(JSON.stringify(await values())==='[4,4,4]','Escape restores all three widths',await values());
 await p.reload();await p.locator('.dashboard-widget').first().waitFor();ok(JSON.stringify(await values())==='[4,4,4]','cancelled preview is not stored',await values());
 // Remove the copy so the other engine starts with the same two-widget row.
 await p.locator('.dashboard-edit').click();await row.locator('.dashboard-widget-more').nth(1).click();await p.getByRole('menuitem',{name:'Remove',exact:true}).click();await p.waitForTimeout(250);
 }finally{await b.close()}
}
process.exit(fail?1:0)
