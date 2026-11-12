import {chromium,webkit} from '@playwright/test'
const base=process.argv[2];let failures=0;
for(const [engine,launcher] of Object.entries({chromium,webkit})){
 const b=await launcher.launch();try{
 const p=await (await b.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'})).newPage();
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const ok=(pass,name,details)=>{console.log(`${pass?'PASS':'FAIL'} ${engine} ${name} ${JSON.stringify(details)}`);if(!pass)failures++};
 await p.goto(`${base}/pages?page=home`);await p.locator('.dashboard-widget').first().waitFor();await p.getByRole('button',{name:'Edit',exact:true}).click();
 const left=p.locator('.dashboard-widget').first(),handle=p.locator('.dashboard-split').first();
 const before=await left.boundingBox(),h=await handle.boundingBox(),row=await p.locator('.dashboard-row[data-row]').first().boundingBox();
 await p.mouse.move(h.x+h.width/2,h.y+40);await p.mouse.down();await p.mouse.move(row.x+row.width/3,h.y+40,{steps:6});await p.waitForTimeout(250);
 const badge=await p.locator('.dashboard-badge').innerText();const preview=await left.boundingBox();
 ok(Math.abs(preview.width-before.width)>30,'width preview changes at snap before release',{badge,before:before.width,during:preview.width});
 await p.mouse.up();await p.waitForTimeout(500);const saved=await left.boundingBox();ok(Math.abs(saved.width-before.width)>30,'release saves snapped width',{after:saved.width});
 await p.getByRole('button',{name:'Undo',exact:true}).first().click();await p.waitForTimeout(250);
 const height=p.locator('.dashboard-row-size').first(),hb=await height.boundingBox(),start=await left.boundingBox();
 await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await p.mouse.down();await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2+80,{steps:5});await p.waitForTimeout(100);
 await p.keyboard.press('Escape');await p.mouse.up();await p.waitForTimeout(500);
 const end=await left.boundingBox();ok(Math.abs(end.height-start.height)<2,'Escape during height drag cancels rather than saving after edit mode ends',{before:start.height,after:end.height,editVisible:await p.getByRole('button',{name:'Edit',exact:true}).isVisible()});
 await p.reload();await p.locator('.dashboard-widget').first().waitFor();ok(Math.abs((await left.boundingBox()).height-start.height)<2,'cancelled height stays unchanged after reload',{});
 ok(errors.length===0,'no page errors',errors);
 }finally{await b.close()}
}
process.exit(failures?1:0)
