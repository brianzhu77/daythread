import { chromium, webkit } from '@playwright/test';
const base='http://127.0.0.1:43961';
let fails=0;
for(const [name,engine] of Object.entries({chromium,webkit})){
 const b=await engine.launch();
 for(const width of [390,1280]){
 const c=await b.newContext({viewport:{width,height:844},serviceWorkers:'block'}),p=await c.newPage();
 await p.goto(base+'/tasks?view=open');await p.getByRole('checkbox').first().waitFor();await p.waitForTimeout(600);
 const notice=()=>p.locator('[data-slot="toast"]:not([data-exiting="true"])');
 async function fresh(){for(const x of await notice().all())await x.locator('.toast__close-button').click();await p.getByRole('checkbox',{name:/Mark .* done/}).first().click();await notice().first().waitFor();await p.waitForTimeout(500);}
 async function drag(target,dx,dy){const r=await target.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:6});await p.waitForTimeout(100);await p.mouse.up();await p.waitForTimeout(450);}
 async function check(label,fn){await fresh();const before=await p.getByRole('checkbox',{checked:false}).count();await fn();const after=await p.getByRole('checkbox',{checked:false}).count();const pass=after===before;console.log(pass?'PASS':'FAIL',name,width,label,{before,after,toasts:await notice().count()});if(!pass)fails++;}
 await check('horizontal 12px Undo must not fire',()=>drag(notice().first().locator('.toast__action'),12,0));
 await check('vertical short 12px Undo must not fire',()=>drag(notice().first().locator('.toast__action'),0,-12));
 await check('up44 Undo hides only',()=>drag(notice().first().locator('.toast__action'),0,-44));
 await fresh(); await p.screenshot({path:`/tmp/ratchet-toast-${name}-${width}.png`});
 await c.close();
 }
 await b.close();
}
process.exitCode=fails?1:0;
