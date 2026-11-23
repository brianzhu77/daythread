import {chromium,webkit} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {SqliteWorkspaceRepository as R} from '../../../src/server/sqlite-repository.ts';
import {draftOf} from '../../../src/domain/day-draft.ts';
const S='/tmp/ratchet-377.sqlite',B='http://127.0.0.1:43980',wait=ms=>new Promise(r=>setTimeout(r,ms));
for(const [name,engine] of Object.entries({chromium,webkit})){
 execFileSync(process.execPath,['--no-warnings','tests/evidence/skipped-days/seed.ts',S]);
 const b=await engine.launch();try{
 const p=await b.newPage({viewport:{width:1280,height:900},timezoneId:'America/Vancouver',serviceWorkers:'block'});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(B);await p.locator('.draft-another').first().waitFor();await wait(600);
 const band=p.locator('.draft-band').filter({has:p.locator('.draft-text',{hasText:/^Kathy homework app$/})});
 await p.route('**/_serverFn/*',r=>r.request().method()==='POST'?r.abort():r.continue());
 await band.locator('.draft-another').click();await p.locator('.draft-days button').first().click();
 await wait(1400);assert.equal(await band.count(),0,'stored move hides after hold');
 // A second client skips it while our move is pending.
 const repo=new R(S,undefined,{allowMissingLegacy:true}),ws=await repo.load(),day=ws.pages.find(x=>x.type==='daily'&&x.date===new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'}).format(new Date()));
 const item=draftOf(ws,day.id).items.find(x=>x.taskId===ws.tasks.find(t=>t.title==='Kathy homework app').id);
 await repo.execute({operationId:crypto.randomUUID(),expectedRevision:ws.revision,action:{type:'skip-draft',pageId:day.id,itemIds:[item.id]}});
 await p.unroute('**/_serverFn/*');
 await p.getByRole('button',{name:'Keep mine',exact:true}).waitFor({timeout:20000});
 assert.match(await p.locator('body').innerText(),/moved "Kathy homework app"/);
 assert.equal(await band.locator('.draft-acts button').count(),0,'no stale actionable band');
 await wait(700);assert.equal(await p.locator('[data-slot=toast]').filter({hasText:'Moved to'}).count(),0,'success toast retired');
 await p.reload();await p.getByRole('button',{name:'Keep mine',exact:true}).waitFor();await wait(4500);
 assert.match(await p.locator('body').innerText(),/moved "Kathy homework app"/);
 assert.equal(await band.locator('.draft-acts button').count(),0);
 assert.deepEqual(errors,[]);console.log(name,'PASS offline->later held->reload: named persistent recovery, no stale action or success toast');
 }finally{await b.close()}
}
