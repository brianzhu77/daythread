// A comment on a line (docs/design/comments.md §2, §4, step 2): held by the block's id, kept out of the document, following a cut to another page, and never taken by a copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { threadsShownOn, threadLineIds } from '../src/domain/comments.ts'
import { lineIdsOnPage, sharedLineId, syncedBlockType } from '../src/domain/synced.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
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

const syncedBlock = (id: string, syncId: string, children: EditorNode[] = []): EditorNode => ({ id, type: syncedBlockType, props: { syncId, roles: '' }, children })
function shared() {
  const h = harness()
  for (const [id, title] of [['a', 'A'], ['b', 'B'], ['c', 'C']] as const) h.run({ type: 'create-document', title, body: '', pageId: id })
  h.save('a', d => [...d, para('before', text('Before')), syncedBlock('sa', 's1', [para('l1', text('First')), para('l2', text('Second'))])])
  h.save('b', d => [...d, para('kept', text('Kept')), syncedBlock('sb', 's1')])
  h.save('c', d => [...d, syncedBlock('sc', 's1')])
  h.run({ type: 'add-comment', pageId: 'a', threadId: 'sh', commentId: 'shc', body: 'On a shared line', at, anchor: { blockId: 'l1', quote: 'First' } })
  return h
}
const shownOn = (h: ReturnType<typeof shared>, id: string) => threadsShownOn(h.ws, id).map(t => t.id)

test('independent: unsyncing the home leaves no mark on its ordinary copy',()=>{
 const h=shared();h.run({type:'unsync-block',pageId:'a',blockId:'sa'});
 console.log('UNSYNC_HOME',{home:shownOn(h,'a'),other:shownOn(h,'b'),ids:lineIdsOnPage(h.page('a'),'l1')});
 assert.deepEqual(threadLineIds(h.ws,h.page('a'),thread(h,'sh').anchor!),[],'shared thread must not target unsynced ordinary line');assert.deepEqual(shownOn(h,'b'),['sh']);
});
test('independent: restore a non-home shared place before its home',()=>{
 const h=shared();const da=h.run({type:'delete-page',pageId:'a',at});const db=h.run({type:'delete-page',pageId:'b',at});h.run({type:'delete-page',pageId:'c',at});h.run({type:'restore-batch',trashId:db.receipt.operationId});assert.deepEqual(shownOn(h,'b'),['sh']);assert.equal(thread(h,'sh').comments[0]!.body,'On a shared line');
});
test('independent: end sharing after home unsync and reply, then Undo preserves reply',()=>{
 const h=shared();h.run({type:'unsync-block',pageId:'a',blockId:'sa'});
 h.run({type:'add-comment',pageId:thread(h,'sh').pageId,threadId:'sh',commentId:'reply',body:'New reply',at});
 h.run({type:'unsync-block',pageId:'b',blockId:'sb'});const end=h.run({type:'unsync-block',pageId:'c',blockId:'sc'});
 const before=structuredClone(thread(h,'sh').comments);h.run({type:'undo',targetOperationId:end.receipt.operationId});
 assert.deepEqual(thread(h,'sh').comments,before);assert.deepEqual(shownOn(h,'c'),['sh']);
});
