import test from 'node:test'
import assert from 'node:assert/strict'
import { harness, todo, under, text, flat, dayId } from './v2-helpers.ts'
import { getDayView, getCalendarTasks, isBlankTask } from '../src/domain/workspace.ts'
import { getUpcomingByDate } from '../src/domain/upcoming.ts'
import { buildSearchIndex } from '../src/domain/search.ts'
import { exportFiles } from '../src/domain/export.ts'
import { pageNodes } from '../src/domain/editor-document.ts'
const today='2026-10-30', yesterday='2026-10-29', older='2026-10-28'
function fixture() {
  const h=harness(); for(const d of [older,yesterday,today]) h.day(d)
  h.save(dayId(older),d=>under(d,'TODO',todo('old-blank','Seed old', 'plan',older),todo('old-named','Older named', 'plan',older)),{today})
  h.save(dayId(yesterday),d=>under(d,'TODO',todo('blank','Seed blank', 'plan',yesterday),todo('spaces','Seed spaces', 'plan',yesterday),todo('named','Named yesterday','plan',yesterday),todo('blank-parent','Seed parent', 'plan',yesterday,[todo('named-child','Named child','plan',yesterday)])),{today})
  h.save(dayId(today),d=>under(d,'TODO',todo('today-blank','Seed today', 'plan',today),todo('today-named','Named today','plan',today)),{today})
  const empty=new Set(['old-blank','blank','spaces','blank-parent','today-blank'])
  for(const d of [older,yesterday,today]) h.save(dayId(d),doc=>{for(const n of flat(doc)) if(empty.has(n.id)) n.content=[text(n.id==='spaces'?' \t\u3000 ':'')];return doc},{today})
  return h
}
const ids=(xs:readonly {id:string}[])=>xs.map(x=>x.id)
test('B69: stored blank and whitespace checkbox rows remain on their pages but no day list counts or carries them',()=>{
 const h=fixture(); const blanks=h.ws.tasks.filter(isBlankTask); assert.ok(blanks.length>=5)
 for(const day of [older,yesterday,today,'2026-10-31']){
  const view=getDayView(h.ws,day)
  for(const name of ['planned','dayTasks','openPool','handoffTasks','carry','paused','attention'] as const) assert.ok(view[name].every(t=>!isBlankTask(t)),`${day} ${name}`)
 }
 const view=getDayView(h.ws,today)
 assert.deepEqual(new Set(ids(view.handoffTasks)),new Set(['editor-task:named','editor-task:named-child']))
 assert.deepEqual(ids(view.carry),['editor-task:old-named'])
 assert.deepEqual(ids(view.dayTasks),['editor-task:today-named'])
 for(const id of ['blank','spaces','blank-parent']) assert.ok(flat(pageNodes(h.page(dayId(yesterday)))).some(n=>n.id===id))
 h.run({type:'plan-tasks',date:today,items:[...view.handoffTasks,...view.carry].map(t=>({taskId:t.id}))})
 const carried=flat(pageNodes(h.page(dayId(today)))); assert.ok(carried.some(n=>n.props?.taskId==='editor-task:named-child'))
 for(const t of blanks) assert.ok(!carried.some(n=>n.props?.taskId===t.id && n.id!=='today-blank'),t.id)
 assert.ok(flat(pageNodes(h.page(dayId(yesterday)))).some(n=>n.id==='blank-parent'))
})
test('B69: paused, attention, deadline and Upcoming paths exclude blank tasks including whitespace titles',()=>{
 const h=fixture();for(const t of h.ws.tasks){t.deadlineOn=today;t.attentionOn=today;if(isBlankTask(t)) t.paused=true}
 const view=getDayView(h.ws,today); assert.equal(view.paused.length,0);assert.ok(view.attention.length>0);assert.ok(view.attention.every(t=>!isBlankTask(t)))
 assert.ok(getCalendarTasks(h.ws,today).every(t=>!isBlankTask(t)))
 const upcoming=getUpcomingByDate(h.ws,older,'2026-11-01').flatMap(d=>d.tasks.map(r=>r.task));assert.ok(upcoming.length>0);assert.ok(upcoming.every(t=>t.title.trim()))
})
test('B69: search and Markdown omit blank tasks; raw workspace backup retains their exact row identities',()=>{
 const h=fixture(),index=buildSearchIndex(h.ws),blanks=new Set(h.ws.tasks.filter(isBlankTask).map(t=>t.id))
 assert.ok(index.lines.every(l=>!l.taskId||!blanks.has(l.taskId)));assert.ok(index.lines.some(l=>l.taskId==='editor-task:named-child'))
 const files=exportFiles(h.ws,new Date('2026-10-30T17:00:00Z'));const md=files.filter(f=>f.path.includes('/days/')).map(f=>f.text).join('\n')
 assert.ok(!/^- \[[ x-]\]\s*$/m.test(md));assert.ok(md.includes('Named child'))
 const backup=JSON.parse(files.find(f=>f.path.endsWith('/workspace.json'))!.text)
 for(const id of blanks) assert.ok(backup.tasks.some((t:{id:string})=>t.id===id))
 assert.ok(JSON.stringify(backup.pages).includes('blank-parent'))
})
test('B69: typing a title activates the same checkbox task; clearing it removes it from lists without deleting its line',()=>{
 const h=fixture(),id='editor-task:blank';const change=(title:string)=>h.save(dayId(yesterday),d=>{const n=flat(d).find(n=>n.id==='blank')!;n.content=[text(title)];return d},{today})
 change('Call the plumber');assert.equal(h.ws.tasks.find(t=>t.id===id)?.title,'Call the plumber');assert.ok(getDayView(h.ws,today).handoffTasks.some(t=>t.id===id));assert.ok(buildSearchIndex(h.ws).lines.some(l=>l.taskId===id))
 change(' \u3000 ');assert.ok(!getDayView(h.ws,today).openPool.some(t=>t.id===id));assert.ok(!getDayView(h.ws,today).handoffTasks.some(t=>t.id===id));assert.ok(flat(pageNodes(h.page(dayId(yesterday)))).some(n=>n.id==='blank'));assert.ok(h.ws.tasks.some(t=>t.id===id))
})

test('B69: a newly inserted blank checkbox is only an editor row until text is typed',()=>{
 const h=harness();h.day(today);h.save(dayId(today),d=>under(d,'TODO',todo('placeholder','', 'plan',today)),{today});assert.ok(!h.ws.tasks.some(t=>t.id==='editor-task:placeholder'));assert.ok(flat(pageNodes(h.page(dayId(today)))).some(n=>n.id==='placeholder'));h.save(dayId(today),d=>{flat(d).find(n=>n.id==='placeholder')!.content=[text('New title')];return d},{today});assert.equal(h.ws.tasks.filter(t=>t.id==='editor-task:placeholder').length,1);assert.ok(getDayView(h.ws,today).planned.some(t=>t.id==='editor-task:placeholder'))
})
