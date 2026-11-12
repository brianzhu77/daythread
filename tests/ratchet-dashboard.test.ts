import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyCommand} from '../src/domain/workspace.ts'
import {harness} from './v2-helpers.ts'
import {firstWidgetView,type Dashboard} from '../src/domain/dashboard.ts'
function setup(){
 const h=harness();const C=(pageId:string,change:unknown)=>h.run({type:'change-database',pageId,change} as never);
 h.run({type:'create-database',pageId:'source',title:'Source',homeBlockId:null});h.run({type:'create-database',pageId:'host',title:'Host',homeBlockId:null});
 C('source',{kind:'addProperty',property:{id:'st',name:'Stage',type:'select',options:[{id:'a',name:'Open',color:'gray'}]}});
 C('host',{kind:'addDashboard',view:{id:'dash',name:'Dash'},rows:[{id:'row',widgets:[{id:'w',source:'source',view:firstWidgetView(h.page('source').database!,'wv')}]}]});
 const D=(change:unknown)=>C('host',{viewId:'dash',...(change as object)});
 const d=()=>h.page('host').database!.views.find(v=>v.id==='dash')!.dashboard!;
 return {h,C,D,d};
}
test('independent: moving a lone widget within its existing row cannot delete it',()=>{
 const {D,d}=setup();const before=structuredClone(d());
 try { D({kind:'moveWidget',widgetId:'w',toRowId:'row',beforeId:null}); } catch(e) { assert.match(String(e),/no.*change|same.*place|nothing.*move|already/i); }
 assert.deepEqual(d(),before);
});
test('independent: duplicating a widget retains a held rule on a deleted property',()=>{
 const {C,D,d}=setup();
 D({kind:'updateWidget',widgetId:'w',fields:{filter:[{by:'st',op:'isAnyOf',value:['a']}]}});
 C('source',{kind:'removeProperty',propertyId:'st'});
 D({kind:'duplicateWidget',widgetId:'w',newId:'copy',newViewId:'copyview',newRowId:'copyrow'});
 assert.deepEqual(d().rows[0]!.widgets[1]!.view.filter,d().rows[0]!.widgets[0]!.view.filter);
});
test('independent: a stale placement refuses unchanged, then retry preserves concurrent settings and replay is inert',()=>{
 const {h,D,d}=setup();
 D({kind:'addWidget',widget:{id:'second',source:'source',view:firstWidgetView(h.page('source').database!,'secondview')},rowId:null,newRowId:'secondrow',beforeId:null});
 const rev=h.ws.revision;
 const change={kind:'moveWidget',viewId:'dash',widgetId:'w',toRowId:null,newRowId:'newrow',rowBeforeId:null,beforeId:null} as const;
 D({kind:'updateWidget',widgetId:'w',fields:{name:'Concurrent name'}});
 const before=JSON.stringify(h.ws);
 const action={type:'change-database',pageId:'host',change} as const;
 // Exercise the same revision/operation contract as the server, not just two sequential helpers.
 assert.throws(()=>applyCommand(h.ws,{operationId:'retry-id',expectedRevision:rev,action}),/Saved elsewhere/);
 assert.equal(JSON.stringify(h.ws),before);
 h.ws=applyCommand(h.ws,{operationId:'retry-id',expectedRevision:h.ws.revision,action}).workspace;
 assert.equal(d().rows.find(r=>r.id==='newrow')!.widgets[0]!.view.name,'Concurrent name');
 const after=JSON.stringify(h.ws);
 h.ws=applyCommand(h.ws,{operationId:'retry-id',expectedRevision:rev,action}).workspace;
 assert.equal(JSON.stringify(h.ws),after);
});
test('independent: a settings edit preserves future placement and reserved dashboard rules',()=>{
 const {D,d}=setup();d().rows[0]!.widgets[0]!.width=11;d().filter=[{by:'future',op:'is',value:'value'}] as never;
 D({kind:'updateWidget',widgetId:'w',fields:{name:'New name'}});
 assert.equal(d().rows[0]!.widgets[0]!.width,11);assert.equal(d().filter![0]!.by,'future');
});
test('independent: dashboard creation respects the database view count cap',()=>{
 const {C,h}=setup();const db=h.page('host').database!;
 while(db.views.length<50) db.views.push({...structuredClone(db.views[0]!),id:`v${db.views.length}`});
 assert.throws(()=>C('host',{kind:'addDashboard',view:{id:'extra',name:'Extra'},rows:[]}),/Too many views/);
});
test('independent: duplicate dashboard preserves missing-source settings and future placement independently',()=>{
 const {h,C,D,d}=setup();D({kind:'updateWidget',widgetId:'w',fields:{filter:[{by:'st',op:'isAnyOf',value:['a']}]}});
 d().rows[0]!.widgets[0]!.width=11;d().filter=[{by:'future',op:'is',value:'value'}] as never;
 h.run({type:'delete-page',pageId:'source',at:'2026-11-12T12:00:00Z'});
 const before=structuredClone(d());
 D({kind:'duplicateDashboard',newViewId:'copydash',ids:{row:'copyrow',w:'copywidget',wv:'copywidgetview'}});
 const copy=h.page('host').database!.views.find(v=>v.id==='copydash')!.dashboard!;
 assert.deepEqual(d(),before);assert.equal(copy.rows[0]!.widgets[0]!.width,11);assert.deepEqual(copy.filter,before.filter);
 assert.deepEqual(copy.rows[0]!.widgets[0]!.view.filter,before.rows[0]!.widgets[0]!.view.filter);
 copy.rows[0]!.widgets[0]!.view.filter=[];assert.equal(d().rows[0]!.widgets[0]!.view.filter.length,1);
 const stable=JSON.stringify(h.ws);
 assert.throws(()=>D({kind:'duplicateDashboard',newViewId:'baddash',ids:{row:'collision',w:'collision',wv:'v-fresh'}}),/Invalid id/);
 assert.equal(JSON.stringify(h.ws),stable,'invalid id mapping refuses atomically');
});
test('independent: swapping within one row keeps each widget own width',()=>{
 const {h,D,d}=setup();D({kind:'addWidget',widget:{id:'two',source:'source',view:firstWidgetView(h.page('source').database!,'twoview')},rowId:'row',beforeId:null});
 D({kind:'sizeSplit',rowId:'row',widgetIds:['w','two'],widths:[4,8]});
 D({kind:'swapWidget',widgetId:'w',withId:'two'});
 assert.deepEqual(d().rows[0]!.widgets.map(w=>[w.id,w.width]),[['two',8],['w',4]]);
});
test('independent: whole-row resize preserves concurrent settings, Undo and stale membership checks',()=>{
 const {h,D,d}=setup();for(const id of ['two','three'])D({kind:'addWidget',widget:{id,source:'source',view:firstWidgetView(h.page('source').database!,id+'view')},rowId:'row',beforeId:null});
 const change={kind:'sizeSplit',rowId:'row',widgetIds:['w','two','three'],widths:[3,6,3]};
 D({kind:'updateWidget',widgetId:'three',fields:{name:'Concurrent name'}});
 const resized=D(change);
 assert.deepEqual(d().rows[0]!.widgets.map(w=>w.width),[3,6,3]);assert.equal(d().rows[0]!.widgets[2]!.view.name,'Concurrent name');
 h.run({type:'undo',targetOperationId:resized.receipt.operationId});
 assert.deepEqual(d().rows[0]!.widgets.map(w=>w.width),[4,4,4]);assert.equal(d().rows[0]!.widgets[2]!.view.name,'Concurrent name');
 D({kind:'swapWidget',widgetId:'w',withId:'two'});const before=JSON.stringify(h.ws);
 assert.throws(()=>D(change),/changed since/);assert.equal(JSON.stringify(h.ws),before);
});
