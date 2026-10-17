// Run against an isolated dev server with DAYTHREAD_LOG=debug and disposable SQLite only.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const title=`SQLITE_PRIVATE_SMOKE_TASK_${Date.now()}`
const base=process.argv[2] ?? 'http://127.0.0.1:3043'
const browser=await chromium.launch({headless:true}),page=await browser.newPage()
const logs=[],errors=[],posts=[]
page.on('console',m=>{if(m.type()==='debug'){try{logs.push(JSON.parse(m.text()))}catch{}}})
page.on('pageerror',e=>errors.push(e.message))
let lost=false
await page.route('**/*',async route=>{
 const req=route.request(),body=req.postData() ?? ''
 if(req.method()==='POST'&&body.includes('save-editor')){
  posts.push(body)
  if(!lost){lost=true;await route.fetch();await route.abort('failed');return}
 }
 await route.continue()
})
try{
 await page.goto(base)
 const row=page.locator('.editor-task-title').first();await row.waitFor({state:'visible',timeout:30000})
 await row.fill(title)
 await page.getByRole('button',{name:'Retry saving',exact:true}).waitFor({state:'visible'})
 await page.getByRole('button',{name:'Retry saving',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.editor-save-line')?.textContent==='Saved')
 assert(lost);assert(posts.length>=2)
 const client=logs.filter(l=>l.event==='command.request'&&l.command==='save-editor')
 assert(client.length>=2);assert.equal(client[0].operationId,client[1].operationId)
 const refresh=logs.find(l=>l.event==='workspace.refresh.start'&&l.triggerOperationId===client[0].operationId)
 assert(refresh);assert.notEqual(refresh.operationId,client[0].operationId)
 assert(!JSON.stringify(logs).includes('SQLITE_PRIVATE_SMOKE_TASK'))
 await page.reload();await page.locator('.editor-task-title').filter({hasText:title}).waitFor()
 assert.equal(await page.locator('.editor-task-title').filter({hasText:title}).count(),1)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({lostResponseRetry:'same operationId',refresh:'separate linked ID',reload:'one task',clientDebug:'content-free',pageErrors:errors.length,saveOperationId:client[0].operationId}))
}finally{await browser.close()}
