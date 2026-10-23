// Additional independent ca70168 cases, on the author's fresh synthetic fixture (no workspace mutations).
import{chromium}from'@playwright/test'
import{readFileSync}from'node:fs'
const[base,manifest]=process.argv.slice(2),m=JSON.parse(readFileSync(manifest,'utf8'))
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Loopback only')
const b=await chromium.launch(),results=[]
const run=async(name,fn)=>{try{await fn();results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message});process.exitCode=1}}
const assert=(v,msg)=>{if(!v)throw Error(msg)}
try{
 for(const [width,touch]of [[1280,false],[390,true]]){
  const c=await b.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch}),p=await c.newPage();p.setDefaultTimeout(7000)
  const go=async path=>{await p.goto(new URL(path,base).href);await p.waitForLoadState('networkidle');await p.waitForTimeout(650)}
  await run(`Tags list opens its document row ${width}`,async()=>{await go('/tags/a11tag');await p.locator('.card-section',{hasText:'A11 target'}).locator('.tag-block').first().click();await p.waitForTimeout(750);assert(new URL(p.url()).searchParams.get('page')===m.pages.target,p.url());assert(await p.locator('[data-id="a11-tagged-row"].block-flash').count()>0,'No target tint')})
  await run(`Same document row as copied line follows task ${width}`,async()=>{await go(`/pages?page=${m.pages.target}&block=a11-tagged-row&task=${m.tasks.tagged}`);assert(new URL(p.url()).pathname===`/day/${m.today}`,p.url())})
  await run(`Gone tag row follows task ${width}`,async()=>{await go(`/pages?page=${m.pages.target}&block=a11-tagged-gone&from=tags`);assert(new URL(p.url()).pathname===`/day/${m.today}`,p.url())})
  await run(`Explicit task works without remembered source row ${width}`,async()=>{await go(`/pages?page=${m.pages.target}&block=never-existed&task=${m.tasks.tagged}`);assert(new URL(p.url()).pathname===`/day/${m.today}`,p.url())})
  await run(`503 exact notice, URL retained, Retry ${width}`,async()=>{
   let deny=true
   const route=async r=>{let u=r.request().url();try{u=decodeURIComponent(u)}catch{}if(deny&&u.includes('_serverFn')&&u.includes('lineId'))await r.fulfill({status:503,body:'unavailable'});else await r.continue()}
   await p.route('**/*',route)
   const path=`/pages?page=${encodeURIComponent(m.pages.past)}&block=${m.rows.pastRow}&task=${m.tasks.past}`
   await go(path)
   const u=new URL(p.url());assert(u.searchParams.get('block')===m.rows.pastRow&&u.searchParams.get('task')===m.tasks.past,'URL parameters lost')
   assert((await p.locator('body').innerText()).includes("Couldn't check where that line is now"),'Missing exact failure text')
   assert(await p.evaluate(()=>scrollY)<10,'Not at top after failure')
   deny=false;await p.getByRole('button',{name:'Retry',exact:true}).first().click();await p.waitForTimeout(1000)
   assert(new URL(p.url()).pathname===`/day/${m.today}`,p.url());await p.unroute('**/*',route)
  })
  await c.close()
 }
}finally{await b.close();for(const r of results)console.log(JSON.stringify(r))}
