// Independent, read-only browser assertions; run ONLY on the server serving seed.ts's synthetic store.
// node critical-check.mjs http://127.0.0.1:PORT manifest.json output-directory
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
const [base,manifestPath,out]=process.argv.slice(2)
if(!base||!manifestPath||!out||!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw Error('Explicit loopback synthetic server, manifest and output directory required')
const f=JSON.parse(readFileSync(manifestPath,'utf8'));assert.equal(f.fixture,'ratchet-a11-v1')
mkdirSync(out,{recursive:true});const results=[],browser=await chromium.launch()
const row=(p,id)=>p.locator(`.bn-block-outer[data-id="${id}"]`).first()
const chip=(p,id)=>row(p,id).locator('.page-ref, .line-ref, [data-line-id]').first()
async function check(name,fn){try{await fn();results.push({name,result:'PASS'})}catch(e){results.push({name,result:'FAIL',error:e.message});process.exitCode=1}}
async function fresh(width,touch,fn){const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,...(process.env.A11_AUTH_STATE?{storageState:process.env.A11_AUTH_STATE}:{})});const page=await context.newPage();try{await fn(page)}finally{await context.close()}}
async function opened(p,path){await p.goto(new URL(path,base).href);await p.waitForLoadState('networkidle');assert.ok(!p.url().includes('/sign-in'),'Unexpected sign-in: authenticate the disposable server explicitly');}
async function geometry(p,id){await row(p,id).waitFor({state:'visible'});await p.waitForTimeout(450)
 return row(p,id).evaluate(el=>{
  const r=el.getBoundingClientRect();let top=0,bottom=innerHeight
  // Only visible fixed/sticky top-level bars; the lower bar fade is 32px above its physical top.
  for(const bar of document.querySelectorAll('.mobile-nav, .mobile-top, .mobile-tabs, .mobile-header, .top-bar, .bottom-nav, .tab-bar')){
   const s=getComputedStyle(bar),b=bar.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||!b.width||!b.height||!['fixed','sticky'].includes(s.position))continue
   if(b.top<=1)top=Math.max(top,b.bottom);if(b.bottom>=innerHeight-100&&b.top>innerHeight/2)bottom=Math.min(bottom,b.top-32)
  }
  const active=document.activeElement
  return {top:r.top,bottom:r.bottom,visibleTop:top,visibleBottom:bottom,target:top+(bottom-top)/3,focused:Boolean(active&&(active.matches('input,textarea')||active.isContentEditable))}
 })}
function assertGeometry(g){assert.ok(g.top>=g.visibleTop&&g.bottom<=g.visibleBottom,JSON.stringify(g));assert.ok(Math.abs(g.top-g.target)<=55,`Not one third of visible area: ${JSON.stringify(g)}`);assert.equal(g.focused,false,'Jump focused an editor/input')}
try {
 for(const [width,touch] of [[1280,false],[390,false],[390,true]]){
  const suffix=`${width}${touch?' touch':''}`
  for(const [i,url]of f.taskUrls.entries())await check(`URL: fresh view ${i?'with':'without'} task= ${suffix}`,()=>fresh(width,touch,async p=>{
   await opened(p,url);assert.equal(new URL(p.url()).pathname,f.taskDestination);await row(p,f.taskBlock).waitFor({state:'visible'});await p.reload();await p.waitForLoadState('networkidle');assert.equal(new URL(p.url()).pathname,f.taskDestination);await row(p,f.taskBlock).waitFor({state:'visible'})
  }))
  await check(`chip and jump ${suffix}`,()=>fresh(width,touch,async p=>{await opened(p,f.source);await chip(p,f.plainChip).click();assertGeometry(await geometry(p,f.plainBlock));await p.screenshot({path:resolve(out,`jump-${width}-${touch}.png`)});await p.goBack();await row(p,f.plainChip).waitFor({state:'visible'});await chip(p,f.plainChip).focus();await p.keyboard.press('Enter');assertGeometry(await geometry(p,f.plainBlock))}))
  await check(`long excerpt at 390 ${suffix}`,()=>fresh(width,touch,async p=>{await opened(p,f.source);const measured=await chip(p,f.plainChip).evaluate(el=>{const r=el.getBoundingClientRect();return {right:r.right,width:r.width,viewport:innerWidth,height:r.height,scroll:document.documentElement.scrollWidth}});assert.ok(measured.right<=measured.viewport&&measured.scroll<=measured.viewport,JSON.stringify(measured));assert.ok(measured.height<40,'Chip wraps to multiple lines')}))
  await check(`chip: trashed page ${suffix}`,()=>fresh(width,touch,async p=>{await opened(p,f.source);const c=chip(p,f.trashChip);assert.ok((await c.innerText()).includes('Independent trashed passage'));assert.ok(await c.evaluate(el=>el.classList.contains('is-trashed')||el.getAttribute('data-state')==='trashed'),'Missing semantic trashed marker');await c.click();assert.equal(new URL(p.url()).searchParams.get('page'),f.trashPage);await p.getByRole('button',{name:'Restore',exact:true}).first().waitFor({state:'visible'});await p.reload();await p.getByRole('button',{name:'Restore',exact:true}).first().waitFor({state:'visible'})}))
 }
}finally{await browser.close();writeFileSync(resolve(out,'results.json'),JSON.stringify(results,null,2));for(const r of results)console.log(`${r.result} ${r.name}${r.error?`: ${r.error}`:''}`)}
