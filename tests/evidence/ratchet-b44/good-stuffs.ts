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

const s=setup();const p=s.ws.pages.find(p=>p.id===s.dayId)!;
const nodes=editorSeed(p,s.ws),gi=nodes.findIndex(n=>n.id===p.sections.find(s=>s.kind==='good-stuffs')!.id);
s.run({type:'save-plain-link',pageId:s.dayId,items:[{blockId:'good-link',url}]});
s.save(n=>[...n.slice(0,gi+1),link('good-link'),...n.slice(gi+1)]);
console.log('Good Stuffs source',item(s.ws)?.sources);
s.save(n=>n.filter(x=>x.id!=='good-link'));
console.log('after deleting deliberate Good Stuffs line',item(s.ws));
assert.ok(item(s.ws),'Good Stuffs save must stay');
