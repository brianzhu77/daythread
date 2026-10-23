// A real second repository writes a new destination after the client's load but before resolver execution.
// Only the independent synthetic SQLite fixture is allowed. Every invocation chooses a new unused future day.
import{chromium}from'@playwright/test'
import{readFileSync}from'node:fs'
import{SqliteWorkspaceRepository}from'../../../src/server/sqlite-repository.ts'
const[base,path]=process.argv.slice(2),f=JSON.parse(readFileSync(path,'utf8'))
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)||f.fixture!=='ratchet-a11-v1'||!f.sqlite.startsWith('/tmp/ratchet-'))throw Error('Independent loopback fixture only')
const repo=new SqliteWorkspaceRepository(f.sqlite),taskId=new URL(f.taskUrls[1],base).searchParams.get('task')
const initial=await repo.load();let day='2026-11-01';while(initial.pages.some(p=>p.date===day)){const d=new Date(`${day}T12:00Z`);d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10)}
const b=await chromium.launch();let injected=0
try{
 const p=await b.newPage()
 await p.addInitScript(()=>{window.__raceFlashes=new Set();new MutationObserver(ms=>{for(const m of ms)if(m.target.classList?.contains('block-flash'))window.__raceFlashes.add(m.target.getAttribute('data-id'))}).observe(document,{subtree:true,attributes:true,attributeFilter:['class']})})
 await p.route('**/*',async r=>{let u=r.request().url();try{u=decodeURIComponent(u)}catch{}
  if(!injected&&u.includes('_serverFn')&&u.includes('lineId')){
   injected++;let w=await repo.load()
   w=(await repo.execute({operationId:`race-ensure-${day}`,expectedRevision:w.revision,action:{type:'ensure-day',date:day}})).workspace
   await repo.execute({operationId:`race-plan-${day}`,expectedRevision:w.revision,action:{type:'plan-task',taskId,date:day,section:'other',from:w.tasks.find(t=>t.id===taskId).plannedOn??undefined,today:'2026-10-22'}})
  }await r.continue()
 })
 await p.goto(new URL(f.taskUrls[1],base).href);await p.waitForLoadState('networkidle');await p.waitForTimeout(2600)
 const w=await repo.load(),row=w.pages.find(p=>p.date===day).sections.flatMap(s=>s.blocks).find(b=>b.taskId===taskId)
 const result={case:'new target created by second writer after browser load',injected,expected:`/day/${day}`,actual:p.url(),plan:w.tasks.find(t=>t.id===taskId).plannedOn,tinted:await p.evaluate(id=>window.__raceFlashes.has(id),row.id)}
 result.pass=injected===1&&new URL(p.url()).pathname===`/day/${day}`&&result.tinted
 console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1
}finally{await b.close()}
