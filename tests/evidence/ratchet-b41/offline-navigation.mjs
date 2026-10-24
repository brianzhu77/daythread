// Usage: node .../offline-navigation.mjs <disposable-loopback-base> [cold|warm]
// No production access. Fresh contexts; no service worker. 'cold' blocks not-yet-loaded route modules while online,
// then goes offline before navigating; this also verifies the fallback when idle prefetch could not finish.
import assert from 'node:assert/strict'
import {chromium,webkit} from '@playwright/test'
const [base,mode='warm']=process.argv.slice(2)
if(!base||!['127.0.0.1','localhost'].includes(new URL(base).hostname)||new URL(base).port==='3000')throw Error('disposable loopback server required')
let failures=0
for(const width of[1280,390]){
 const browser=await(width===390?webkit:chromium).launch()
 try{
  const ctx=await browser.newContext({viewport:{width,height:900},...(width===390?{hasTouch:true,isMobile:true}:{}),serviceWorkers:'block'})
  const p=await ctx.newPage(),failedRequests=[],documentRequests=[],errors=[]
  p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));p.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===p.mainFrame())documentRequests.push(r.url())})
  if(mode==='cold')await p.route('**/assets/pages-*.js',r=>r.abort('failed'))
  await p.goto(base+'/day/2026-10-22',{waitUntil:'networkidle'});await p.locator('.continuous-editor').waitFor();await p.waitForTimeout(1500)
  const beforeDocuments=documentRequests.length
  await ctx.setOffline(true)
  const pages=width===390?p.locator('.tab-bar [aria-label="Pages"]'):p.locator('.sidebar .side-row').filter({hasText:/^Pages$/}).first()
  try{await pages.click({timeout:5000})}catch(e){errors.push('click: '+e.message.split('\n')[0])}
  await p.waitForTimeout(4000)
  const state=await p.evaluate(()=>({url:location.href,shell:!!document.querySelector('.app'),text:document.body.innerText.slice(0,1500),pages:!!document.querySelector('.pages-screen')})).catch(e=>({url:p.url(),shell:false,text:String(e),pages:false}))
  const navigationDelta=documentRequests.length-beforeDocuments
  const inAppOffline=/Offline[\s\S]*screen[\s\S]*connection/i.test(state.text)
  const onPages=new URL(state.url).pathname==='/pages'&&state.shell
  const pass=state.shell&&(onPages||inAppOffline)&&navigationDelta===0
  console.log(JSON.stringify({width,mode,pass,navigationDelta,state,failedRequests,errors}))
  await p.screenshot({path:`/tmp/ratchet177-${mode}-${width}.png`}).catch(()=>{})
  if(!pass)failures++
  await ctx.setOffline(false)
 }finally{await browser.close()}
}
assert.equal(failures,0,'offline screen navigation must keep the app shell and avoid full document reload')
