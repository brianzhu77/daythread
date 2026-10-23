import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
const [base,db,engine]=process.argv.slice(2)
if(!db.startsWith('/tmp/ratchet-163-')||new URL(base).hostname!=='127.0.0.1')throw Error('isolated fixture only')
const repo=new SqliteWorkspaceRepository(db),browser=await pw[engine].launch({headless:true}),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'}).format(new Date())
const w=await repo.load(),task=w.tasks.find(t=>t.title.startsWith('indent child '));assert.ok(task,'author-created child fixture')
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(7000)
const row=()=>p.locator('[data-node-type="blockContainer"]',{hasText:task.title}).last()
try{
await p.goto(base,{waitUntil:'networkidle'});await row().locator('.bn-inline-content').first().tap({position:{x:10,y:8}})
const checkbox=row().locator('input[type=checkbox]');if(!await checkbox.isChecked())await checkbox.tap();await p.waitForTimeout(1100);await p.reload({waitUntil:'networkidle'})
for(const name of ['Indent','Outdent']){await row().locator('.bn-inline-content').first().tap({position:{x:10,y:8}});await p.locator(`.editor-phone-toolbar [aria-label="${name}"]`).tap();await p.waitForTimeout(1100);assert.equal((await repo.load()).tasks.find(t=>t.id===task.id)?.status,'done',name+' preserves backend identity/status')}
await p.reload({waitUntil:'networkidle'});assert.equal((await repo.load()).tasks.find(t=>t.id===task.id)?.status,'done');assert.equal((await repo.load()).tasks.length,w.tasks.length)
const desktop=await browser.newPage({viewport:{width:1280,height:900}});await desktop.goto(base,{waitUntil:'networkidle'});const first=await desktop.evaluate(()=>{const b=[...document.querySelectorAll('[data-node-type="blockContainer"]')],i=b.findIndex(x=>x.querySelector(':scope > [data-content-type="heading"]')?.textContent.includes('Top 3'));return b[i+1]?.dataset.id});assert.ok(first)
const el=desktop.locator(`[data-node-type="blockContainer"][data-id="${first}"] .bn-inline-content`).first();await el.click();await desktop.keyboard.type('Independent Top3 boundary');await desktop.waitForTimeout(1200);await desktop.keyboard.press('Tab');await desktop.waitForTimeout(1200)
const page=(await repo.load()).pages.find(x=>x.date===today),nodes=JSON.parse(page.editorJSON);const top=page.sections.find(s=>s.kind==='top3');assert.ok(top,'Top3 section exists')
const taskNow=(await repo.load()).tasks.find(t=>t.title==='Independent Top3 boundary');assert.ok(taskNow);assert.ok(top.blocks.some(b=>b.taskId===taskNow.id));assert.equal(nodes.find(n=>n.id===top.id)?.children?.some(c=>c.id===first)??false,false,'Tab must not nest first task under heading');assert.equal(await desktop.evaluate(()=>!!document.activeElement?.closest('.bn-editor')),true)
await desktop.locator('[data-content-type="heading"]').filter({hasText:'TODO - Other'}).first().locator('.bn-inline-content').click();await desktop.keyboard.press('Tab');await desktop.waitForTimeout(300);assert.equal(await desktop.evaluate(()=>!!document.activeElement?.closest('.bn-editor')),true)
assert.deepEqual(errors,[]);console.log('PASS',engine,'actual task id/done state across phone indent/outdent/reload; desktop Top3 task remains in section; heading/first-row Tab keeps editor focus')
}finally{await browser.close()}
