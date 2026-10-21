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


let {ws,d20}=setup();const h={id:'timed-heading',type:'heading',props:{level:2},content:[text('see '),ref('R','heading-time')]};ws=save(ws,d20,doc=>[...doc,h]);const at=page(ws,d20).sections.find(s=>s.id===h.id)!.refs![0]!.at;ws=save(ws,d20,doc=>doc.filter(n=>n.id!==h.id));console.log('after delete metadata',JSON.stringify(page(ws,d20).editorBlockMetadata));ws=save(ws,d20,doc=>[...doc,h]);const back=page(ws,d20).sections.find(s=>s.id===h.id)!.refs![0]!.at;console.log(JSON.stringify({at,back}));assert.equal(back,at,'restoring a deleted heading must retain its reference time');
