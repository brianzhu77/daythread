import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

// B44 §4a (Lead 17ab8da6): a link pasted and kept plain is still remembered, with no page; it goes with its line.
const day = '2026-10-23', url = 'https://sspai.com/post/12345'
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action) => run(ws, action).workspace
const link = (id: string, href = url): EditorNode => ({ id, type: 'bulletListItem', props: {}, content: [{ type: 'link', href, content: [{ type: 'text', text: href, styles: {} }] }] as never, children: [] })
function setup() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: day })
  const dayId = ws.pages[0]!.id
  const save = (edit: (nodes: EditorNode[]) => EditorNode[]) => { const p = ws.pages.find(x => x.id === dayId)!; ws = ok(ws, { type: 'save-editor', pageId: dayId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) }) }
  return { dayId, save, run: (a: Action) => { ws = ok(ws, a) }, get ws() { return ws } }
}
const item = (ws: Workspace) => ws.materials.find(m => m.url === url)

// Browser ordering and two pages with the same URL, plus decision retention.
for(const acted of [false,true]){
 const s=setup();s.run({type:'save-plain-link',pageId:s.dayId,items:[{blockId:'l1',url}]});s.save(n=>[...n,link('l1')]);
 if(acted){const m=item(s.ws)!;m.decisions=[{date:day,decision:'keep'}];}
 s.save(n=>n.filter(x=>x.id!=='l1'));
 assert.equal(Boolean(item(s.ws)),acted,'acted-on record retained, untouched record removed');
}
const s=setup();s.run({type:'save-plain-link',pageId:s.dayId,items:[{blockId:'l1',url}]});s.save(n=>[...n,link('l1')]);
s.run({type:'create-document',pageId:'second',title:'Second',body:''});
let p=s.ws.pages.find(x=>x.id==='second')!;
s.run({type:'save-plain-link',pageId:'second',items:[{blockId:'l2',url}]});
p=s.ws.pages.find(x=>x.id==='second')!;s.run({type:'save-editor',pageId:'second',expectedContent:pageContentKey(p),document:JSON.stringify([...editorSeed(p,s.ws),link('l2')])});
s.save(n=>n.filter(x=>x.id!=='l1'));assert.equal(item(s.ws)?.sources.length,1);assert.equal(item(s.ws)?.sources[0]?.pageId,'second');
p=s.ws.pages.find(x=>x.id==='second')!;s.run({type:'save-editor',pageId:'second',expectedContent:pageContentKey(p),document:JSON.stringify(editorSeed(p,s.ws).filter(x=>x.id!=='l2'))});assert.equal(item(s.ws),undefined);
console.log('PASS browser-order lifecycle, decision retention and two-page reference removal');
