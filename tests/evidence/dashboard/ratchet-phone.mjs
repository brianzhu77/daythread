import {chromium,webkit} from '@playwright/test'
let failed=0;
for(const [name,engine] of Object.entries({chromium,webkit})){
 const b=await engine.launch();try{
 const c=await b.newContext({viewport:{width:390,height:800},hasTouch:true,serviceWorkers:'block'});c.setDefaultTimeout(8000);const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.argv[2]+'/pages?page=home');await p.locator('.dashboard-widget').first().waitFor();
 const books=p.locator('.dashboard-widget[aria-label="Books · Table"]');await books.scrollIntoViewIfNeeded();await p.waitForTimeout(400);
 const ok=(label,pass,detail)=>{console.log(`${pass?'PASS':'FAIL'} ${name} ${label} ${JSON.stringify(detail??'')}`);if(!pass)failed++};
 ok('clipped tall table with visible expansion',await books.getByRole('button',{name:'Show more',exact:true}).isVisible());
 await books.getByRole('button',{name:'Show more',exact:true}).click();await p.waitForTimeout(100);
 const first=await books.locator('.dashboard-clip').evaluate(e=>e.getBoundingClientRect().height);
 // SPA browser history retains the session cache even after dashboard unmounts.
 await p.setViewportSize({width:1280,height:800});await p.waitForTimeout(150);await p.locator('a[href="/pages?page=runs"]').first().click();await p.waitForTimeout(200);await p.locator('a[href="/pages?page=home"]').first().click();await books.waitFor();await p.setViewportSize({width:390,height:800});await p.waitForTimeout(250);await books.scrollIntoViewIfNeeded();await p.waitForTimeout(200);
 ok('expansion survives SPA leave and return',await books.getByRole('button',{name:'Show less',exact:true}).isVisible());
 // The responsive layout remounts each widget frame; expanded state must survive.
 await p.setViewportSize({width:1280,height:800});await p.waitForTimeout(150);await p.setViewportSize({width:390,height:800});await p.waitForTimeout(250);await books.scrollIntoViewIfNeeded();await p.waitForTimeout(200);
 ok('expansion survives responsive remount',await books.getByRole('button',{name:'Show less',exact:true}).isVisible()&&await books.locator('.dashboard-clip').evaluate(e=>e.getBoundingClientRect().height)>400,{first});
 const horizontal=await books.evaluate(w=>[...w.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+20&&['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>{e.scrollLeft=80;return {class:e.className,moved:e.scrollLeft>0}}));
 if(horizontal.length)ok('wide table can scroll sideways',horizontal.some(e=>e.moved),horizontal);else console.log('NOT RUN '+name+' horizontal table scrolling: seed table fits width');
 ok('no horizontal page overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 ok('no page errors',errors.length===0,errors);
 }finally{await b.close()}
}
process.exit(failed?1:0)
