// A comment on a line (docs/design/comments.md §2, §4, step 2): held by the block's id, kept out of the document, following a cut to another page, and never taken by a copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { applyDiff, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { dayId, flat, harness, nodesOf, para, text, today, todo, tomorrow } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
function pages() {
  const h = harness()
  h.run({ type: 'create-document', title: 'One', body: '', pageId: 'one' })
  h.run({ type: 'create-document', title: 'Two', body: '', pageId: 'two' })
  h.save('one', () => [para('l1', text('A line')), para('l2', text('Another'))])
  h.save('two', () => [para('t1', text('Over here'))])
  return h
}
const add = (h: ReturnType<typeof pages>, pageId = 'one', blockId = 'l1', threadId = 'th') => h.run({ type: 'add-comment', pageId, threadId, commentId: `${threadId}c`, body: 'A note', at, anchor: { blockId, quote: 'A line' } })
const thread = (h: ReturnType<typeof pages>, id = 'th') => h.ws.threads!.find(t => t.id === id)!


test('ordinary anchored line later made synced retains an identifiable home',()=>{
 const h=pages();add(h);
 h.save('one',()=>[{id:'shared',type:'syncedBlock',props:{syncId:'record',roles:''},children:[para('l1',text('A line'))]}]);
 const t=thread(h);const home=flat(nodesOf(h.page(t.pageId))).find(n=>n.id===t.anchor?.blockId);
 console.log('AFTER_SYNC',{anchor:t.anchor,homeFound:!!home,ids:flat(nodesOf(h.page('one'))).map(n=>n.id)});assert.ok(home);
});
test('anchored line synced then original place removed retains a visible thread home',()=>{
 const h=pages();add(h);
 h.save('one',()=>[{id:'shared',type:'syncedBlock',props:{syncId:'record',roles:''},children:[para('l1',text('A line'))]}]);
 h.save('two',()=>[{id:'copy',type:'syncedBlock',props:{syncId:'record',roles:''},children:[]}]);
 h.save('one',()=>[para('l2',text('Original place removed'))]);
 const t=thread(h),home=flat(nodesOf(h.page(t.pageId))).find(n=>n.id===t.anchor?.blockId);
 console.log('REMOVED_ORIGINAL',{pageId:t.pageId,anchor:t.anchor,homeFound:!!home,surviving:flat(nodesOf(h.page('two'))).map(n=>n.id)});assert.ok(home);
});
