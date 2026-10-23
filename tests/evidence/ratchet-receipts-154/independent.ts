import assert from 'node:assert/strict'
import {applyCommand,createEmptyWorkspace,compactReceipts,receiptWindow,tombstoneWindow} from '../../../src/domain/workspace.ts'
let w=applyCommand(createEmptyWorkspace(),{operationId:'day',expectedRevision:0,action:{type:'ensure-day',date:'2026-10-23'}}).workspace
const p=w.pages[0]!,action={type:'add-task' as const,pageId:p.id,sectionId:p.sections[0]!.id,title:'独立 replay 🐈'},original={operationId:'original',expectedRevision:w.revision,action}
w=applyCommand(w,original).workspace
const receipt=w.receipts.original
w=applyCommand(w,{operationId:'undo',expectedRevision:w.revision,action:{type:'undo',targetOperationId:'original'}}).workspace
const rev=w.revision
assert.equal(applyCommand(w,original).workspace.tasks.length,0)
assert.equal(applyCommand(w,original).workspace.revision,rev)
assert.deepEqual(applyCommand(w,original).receipt,receipt)
assert.deepEqual(w.undo,undefined)
const legacy=structuredClone(w);legacy.receipts.original!.fingerprint=JSON.stringify(action)
const next=applyCommand(legacy,{operationId:'next',expectedRevision:legacy.revision,action:{type:'ensure-day',date:'2026-10-24'}}).workspace
assert.match(next.receipts.original!.fingerprint!,/^c128:/)
assert.equal(applyCommand(next,original).workspace.tasks.length,0)
assert.deepEqual(next.undo,undefined)
const old=structuredClone(w), filler=Object.fromEntries(Array.from({length:receiptWindow},(_,i)=>[`filler-${i}`,{operationId:`filler-${i}`,message:'ok',fingerprint:'c128:000'}]))
old.receipts=compactReceipts({...old.receipts,...filler})
assert.equal(old.receipts.original!.fingerprint,'expired')
assert.throws(()=>applyCommand(old,{...original,expectedRevision:old.revision}),/already applied/)
const beyond=structuredClone(w)
beyond.receipts=compactReceipts({...beyond.receipts,...Object.fromEntries(Array.from({length:receiptWindow+tombstoneWindow},(_,i)=>[`b-${i}`,{operationId:`b-${i}`,message:'ok',fingerprint:'c128:000'}]))})
assert.equal(beyond.receipts.original,undefined)
assert.throws(()=>applyCommand(beyond,original),/Saved elsewhere/)
// Exact finite boundary: generic latest-revision actions CAN apply again after their tombstone is dropped.
const replay=applyCommand(beyond,{...original,expectedRevision:beyond.revision})
assert.equal(replay.workspace.tasks.length,1)
console.log('PASS: Undo/replay, CJK+emoji legacy conversion, tombstone refusal, browser stale revision; confirmed finite latest-revision replay boundary beyond 3500')
