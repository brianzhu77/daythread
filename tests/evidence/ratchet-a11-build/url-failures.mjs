// Independent URL failure/recovery cases. Loopback synthetic fixture from ../ratchet-a11-step2/seed.ts only.
import {chromium} from '@playwright/test'
import {readFileSync} from 'node:fs'
const [base,manifest]=process.argv.slice(2)
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Loopback only')
const f=JSON.parse(readFileSync(manifest,'utf8')),b=await chromium.launch(),results=[]
try{
 for(const withTask of [false,true]){
  const c=await b.newContext(),p=await c.newPage(),url=new URL(f.trashedTaskUrl,base)
  if(!withTask)url.searchParams.delete('task')
  await p.goto(url.href);await p.waitForLoadState('networkidle');await p.waitForTimeout(650)
  results.push({case:`trashed source ${withTask?'with':'without'} task=`,pass:new URL(p.url()).pathname===f.taskDestination,expected:f.taskDestination,actual:p.url()})
  await c.close()
 }
 const c=await b.newContext(),p=await c.newPage();let blocked=0
 const deny=async r=>{let u=r.request().url();try{u=decodeURIComponent(u)}catch{}if(u.includes('_serverFn')&&u.includes('lineId')){blocked++;await r.fulfill({status:503,body:'unavailable'})}else await r.continue()}
 await p.route('**/*',deny);await p.goto(new URL(f.taskUrls[1],base).href);await p.waitForLoadState('networkidle');await p.waitForTimeout(650)
 const old=new URL(f.taskUrls[1],base).searchParams.get('block')
 const wrongTint=await p.locator(`[data-id="${old}"].block-flash`).count()
 const notice=/couldn.t|try again|retry|unavailable/i.test(await p.locator('body').innerText())
 results.push({case:'resolver 503 must not silently tint history',pass:blocked===1&&wrongTint===0&&notice,blocked,wrongTint,notice,url:p.url()})
 await p.unroute('**/*',deny);await p.reload();await p.waitForLoadState('networkidle');await p.waitForTimeout(650)
 results.push({case:'reload recovers after resolver service returns',pass:new URL(p.url()).pathname===f.taskDestination,expected:f.taskDestination,actual:p.url()})
 await c.close()
}finally{await b.close();for(const r of results)console.log(JSON.stringify(r));if(results.some(r=>!r.pass))process.exitCode=1}
