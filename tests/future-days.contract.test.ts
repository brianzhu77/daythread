/** Ratchet's independent R1–R9 contract scaffold.
 * Opt in after applying to the implementation branch:
 * FUTURE_DAYS_CONTRACT=1 node --test tests/future-days.contract.test.ts
 * Default skips are deliberate: baseline c424bb2 still auto-creates pages in place().
 * Only bind confirmedCreate() if the implementation introduces a different explicit-create action.
 * Navigation/cancel must be tested at the browser boundary; these tests do not simulate them with ensure-day.
 */
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyCommand,createEmptyWorkspace,getDayView} from '../src/domain/workspace.ts'
import type {Action} from '../src/domain/types.ts'
const enabled=process.env.FUTURE_DAYS_CONTRACT==='1'
const contract=(name:string,body:()=>void)=>test(name,{skip:enabled?false:'Scaffold: opt in against future-days implementation'},body)
const today='2026-10-17',future='2026-10-21'
function setup(){let state=createEmptyWorkspace(),serial=0;return{
 get state(){return state},
 run(action:Action,operationId=`future-contract-${++serial}`){const r=applyCommand(state,{operationId,expectedRevision:state.revision,action});state=r.workspace;return r},
}}
function source(){const s=setup();s.run({type:'ensure-day',date:today});const page=s.state.pages.find(p=>p.date===today)!;const section=page.sections.find(x=>x.kind==='other')!;s.run({type:'add-task',pageId:page.id,sectionId:section.id,title:'Future contract task',plannedOn:today,deadlineOn:'2026-10-23'});return{s,page,section,task:s.state.tasks[0]!}}
// Binding seam, not a claim that ensure-day itself distinguishes navigation from explicit consent.
const confirmedCreate=(s:ReturnType<typeof setup>,date:string,operationId?:string)=>s.run({type:'ensure-day',date},operationId)
const noFuturePage=(s:ReturnType<typeof setup>)=>assert.equal(s.state.pages.some(p=>p.date===future),false)
contract('R1: today creation is one templated daily page',()=>{const s=setup();confirmedCreate(s,today);confirmedCreate(s,today);const pages=s.state.pages.filter(p=>p.date===today);assert.equal(pages.length,1);assert.deepEqual(pages[0]!.sections.map(x=>x.kind),['top3','other','events','good-stuffs','notes'])})
contract('R7/R9: reading a future DayView is pure and returns planned tasks without a page',()=>{const {s,task}=source();s.run({type:'plan-task',taskId:task.id,date:future});noFuturePage(s);const before=structuredClone(s.state);const view=getDayView(s.state,future);assert.equal(view.page,null);assert(view.planned.some(t=>t.id===task.id));assert.deepEqual(s.state,before)})
contract('R9: plan-task stores placement and preserves identity/deadline without creating a future page',()=>{const{s,task}=source();s.run({type:'plan-task',taskId:task.id,date:future,section:'top3'});noFuturePage(s);assert.equal(s.state.tasks.length,1);assert.equal(s.state.tasks[0]!.id,task.id);assert.equal(s.state.tasks[0]!.deadlineOn,'2026-10-23');assert.equal(s.state.tasks[0]!.plannedOn,future);assert.equal(s.state.placements.filter(p=>p.taskId===task.id&&p.date===future&&p.state==='included').length,1)})
contract('R9: assigning a future deadline alone creates no future page or placement',()=>{const s=setup();confirmedCreate(s,today);const p=s.state.pages[0]!;s.run({type:'add-task',pageId:p.id,sectionId:p.sections.find(x=>x.kind==='other')!.id,title:'Deadline only',deadlineOn:future,plannedOn:null});noFuturePage(s);assert.equal(s.state.tasks[0]!.deadlineOn,future);assert.equal(s.state.tasks[0]!.plannedOn,null);assert.equal(s.state.placements.length,0)})
contract('R9: add-task with future plannedOn does not create destination page',()=>{const s=setup();confirmedCreate(s,today);const p=s.state.pages[0]!;s.run({type:'add-task',pageId:p.id,sectionId:p.sections.find(x=>x.kind==='other')!.id,title:'Plan ahead at creation',plannedOn:future});noFuturePage(s);assert.equal(s.state.tasks[0]!.plannedOn,future)})
contract('R5: explicit creation materializes existing placements once, preserving the same task',()=>{const{s,task}=source();s.run({type:'plan-task',taskId:task.id,date:future,section:'top3'});noFuturePage(s);confirmedCreate(s,future,'create-future-once');const p=s.state.pages.find(p=>p.date===future)!;assert(p);const rows=p.sections.flatMap(s=>s.blocks).filter(b=>b.taskId===task.id);assert.equal(rows.length,1);assert.equal(s.state.tasks.length,1);assert.equal(s.state.tasks[0]!.id,task.id);assert.equal(p.sections.find(s=>s.kind==='top3')!.blocks.filter(b=>b.taskId===task.id).length,1);confirmedCreate(s,future,'create-future-again');assert.equal(s.state.pages.filter(p=>p.date===future).length,1);assert.equal(s.state.pages.find(p=>p.date===future)!.sections.flatMap(s=>s.blocks).filter(b=>b.taskId===task.id).length,1)})
contract('R5: lost-response replay of explicit create is harmless',()=>{const s=setup();confirmedCreate(s,future,'lost-create');const before=structuredClone(s.state);confirmedCreate(s,future,'lost-create');assert.deepEqual(s.state,before)})
contract('R8: reopening an existing future page never replaces user text or editor document',()=>{const s=setup();confirmedCreate(s,future);const p=s.state.pages[0]!;s.run({type:'add-text',pageId:p.id,sectionId:p.sections.find(x=>x.kind==='notes')!.id,text:'USER_CONTENT_MUST_SURVIVE'});const before=structuredClone(s.state.pages);getDayView(s.state,future);confirmedCreate(s,future);assert.deepEqual(s.state.pages,before)})
// Domain/API integration seams deliberately stay TODO until the author exposes their actual boundary.
// Do not make these pass by inventing an adapter that simply does nothing.
test.todo('R2/R3 browser: today next arrow and future picker cells cannot create a page')
test.todo('R4/R6 browser: future Calendar prompt / Cancel / Escape / outside click leave revision, receipts and pages unchanged')
test.todo('R7 browser: direct URL, refresh and back/forward show missing-future state without ensure-day')
test.todo('R5 browser+SQLite: rapid Create double click, stale revision and lost response still create exactly once')
