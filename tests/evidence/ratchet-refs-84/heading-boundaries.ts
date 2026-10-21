import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, pasteRecords } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { linkedFrom, recentPages } from '../../../src/domain/page-tree.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

// A9a `[[` page links + B15 Linked from order (docs/plan/a9-page-links.md @ a9e0842, Ratchet #83).
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action, operationId?: string) => run(ws, action, operationId).workspace
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)!
const ref = (pageId: string, refId: string, newTitle?: string) => ({ type: 'pageRef', props: { pageId, refId, ...(newTitle ? { newTitle } : {}) } })
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const line = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', content })
function save(ws: Workspace, pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) {
  const p = page(ws, pageId)
  return ok(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
}
const refuses = (ws: Workspace, pageId: string, edit: (doc: EditorNode[]) => EditorNode[], pattern: RegExp) => {
  const p = page(ws, pageId)
  assert.throws(() => run(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) }), pattern)
}
const blockOf = (ws: Workspace, pageId: string, id: string) => page(ws, pageId).sections.flatMap(s => s.blocks).find(b => b.id === id)!
const from = (ws: Workspace, id: string) => linkedFrom(ws, id).map(e => e.page.id)
/** Oct 19 and Oct 20, a top-level page R ("韩国大酱汤") and X, and a page D in Pages. */
function setup() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-20' })
  ws = ok(ws, { type: 'create-document', title: '韩国大酱汤', body: '', pageId: 'R' })
  ws = ok(ws, { type: 'create-document', title: 'X', body: '', pageId: 'X' })
  ws = ok(ws, { type: 'create-document', title: 'D', body: '', pageId: 'D' })
  return { ws, d19: 'day:2026-10-19', d20: 'day:2026-10-20' }
}


for(const order of ['cut-first','paste-first']){let {ws,d19,d20}=setup();const h={id:'move-heading',type:'heading',props:{level:2},content:[ref('R','move-id')]};ws=save(ws,d20,doc=>[...doc,h]);const at=page(ws,d20).sections.find(s=>s.id===h.id)!.refs![0].at;if(order==='cut-first'){ws=save(ws,d20,doc=>doc.filter(n=>n.id!==h.id));ws=save(ws,d19,doc=>[...doc,h])}else{ws=save(ws,d19,doc=>[...doc,h]);ws=save(ws,d20,doc=>doc.filter(n=>n.id!==h.id))}assert.equal(page(ws,d19).sections.find(s=>s.id===h.id)!.refs![0].at,at);assert.deepEqual(from(ws,'R'),[d19]);console.log('ok heading move '+order+' retains identity/time')}
for(const type of ['paragraph','heading','bulletListItem','numberedListItem','quote']){let {ws,d20}=setup();refuses(ws,d20,doc=>[...doc,{id:'bad',type,content:[ref('missing','bad-id')]}],/Page not found/);refuses(ws,d20,doc=>[...doc,{id:'dup',type,content:[ref('R','same-id'),ref('R','same-id')]}],/appears twice/);ws=ok(ws,{type:'delete-page',pageId:'R',at:'2026-10-20T18:00:00Z'});refuses(ws,d20,doc=>[...doc,{id:'trash',type,content:[ref('R','trash-id')]}],/in trash/);console.log('ok '+type+' rejects missing/duplicate/trashed new refs')}
