import {chromium,webkit} from '@playwright/test'
const base=process.argv[2];let failures=0;
for(const [name,engine] of Object.entries({chromium,webkit})){
 const b=await engine.launch();try{
 const c=await b.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),a=await c.newPage(),other=await c.newPage();c.setDefaultTimeout(8000);
 for(const p of [a,other]){await p.goto(base+'/pages?page=home');await p.locator('.dashboard-widget[aria-label="To-dos · Open"]').waitFor();await p.waitForTimeout(300)}
 await a.locator('.dashboard-edit').click();await a.locator('.dashboard-widget[aria-label="To-dos · Open"] .dashboard-widget-more').click();await a.getByRole('menuitem',{name:'Remove',exact:true}).click();await a.waitForTimeout(400);
 const stale=await other.locator('.dashboard-widget[aria-label="To-dos · Open"]').count();const bodies=[];
 other.on('response',r=>{if(r.request().method()==='POST'&&r.url().includes('_serverFn'))bodies.push(r.text().catch(()=>''))});
 await other.locator('.dashboard-widget[aria-label="To-dos · Open"] .database-rule-remove, .dashboard-widget[aria-label="To-dos · Open"] button[aria-label^="Remove"]').first().click();await other.waitForTimeout(900);
 const responses=await Promise.all(bodies),refused=responses.some(s=>s.includes('Saved elsewhere'));
 const gone=await other.locator('.dashboard-widget[aria-label="To-dos · Open"]').count()===0;
 const notice=await other.getByText(/Saved elsewhere|widget.s gone|couldn.t save/i).count();
 const pass=stale===1&&refused&&gone&&notice>0;
 console.log(`${pass?'PASS':'FAIL'} ${name} stale filter edit after another tab removes widget gives feedback ${JSON.stringify({stale,refused,gone,notice,posts:responses.length})}`);if(!pass)failures++;
 await a.getByRole('button',{name:'Undo',exact:true}).last().click();await a.waitForTimeout(350);
 }finally{await b.close()}
}
process.exit(failures?1:0)
