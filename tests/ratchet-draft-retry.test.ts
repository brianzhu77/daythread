// Runs the actual hook body with controlled hooks/events, no React renderer or paid model call.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
import {harness,dayId,today} from './v2-helpers.ts'
import {draftOf,draftStale,draftView} from '../src/domain/day-draft.ts'
test('independent: failed old-recipe remakes stop after two automatic asks',async()=>{
 const h=harness();h.day(today);h.run({type:'set-draft',pageId:dayId(today),status:'ready',moreOpen:[],allowedTaskIds:[],items:[]});
 const effects:(()=>unknown)[]=[],events=new Map<string,()=>unknown>();let calls=0;
 const raw=readFileSync(new URL('../src/components/use-day-draft.ts',import.meta.url),'utf8');
 const source=stripTypeScriptTypes(raw).replace(/^import .*\n/gm,'').replace(/^export /gm,'');
 const context={draftOf,draftStale,draftView,Date,Map,Set,JSON,Promise,setTimeout,clearTimeout,
 useCallback:(fn:unknown)=>fn,useEffect:(fn:()=>unknown)=>effects.push(fn),useMemo:(fn:()=>unknown)=>fn(),useRef:(v:unknown)=>({current:v}),useSyncExternalStore:(_:unknown,get:()=>unknown)=>get(),
 useWorkspace:()=>({workspace:h.ws,latest:()=>h.ws,offline:false,refresh:async()=>{},run:async()=>true}),workspaceOwner:()=>null,newOperationId:()=>crypto.randomUUID(),todayIso:()=>today,flushEditor:async()=>true,
 prepareDayDraft:async()=>{calls++;return {setDraft:null,owner:'local',modelOn:true,remakeFailed:true}},
 document:{visibilityState:'visible',addEventListener:(name:string,fn:()=>unknown)=>events.set(name,fn),removeEventListener:()=>{}},window:{addEventListener:(name:string,fn:()=>unknown)=>events.set(name,fn),removeEventListener:()=>{}}};
 const hook=runInNewContext(`${source}\nuseDayDraft`,context);hook(h.page(dayId(today)));for(const effect of effects)effect();
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));await settle();
 for(let i=0;i<3;i++){events.get('focus')!();await settle()}
 assert.ok(calls<=2,`four focus cycles made ${calls} requests; expected at most two failed automatic asks`);
});
