import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, pasteRecords } from '../../../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { defaultLinkTitle } from '../../../src/domain/url-key.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

// B43 (Lead, Ratchet): the title and description read for a page a paste made, applied only to that untouched page,
// bound to the paste; a late result never overrides him, and the paste's Undo still treats the page as unedited.
const day = '2026-10-23', url = 'https://felixrieseberg.com/how-to-be-more-ambitious'
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action, operationId?: string) => run(ws, action, operationId).workspace
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)!
function pasted(kind = 'notes') {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: day })
  const dayId = ws.pages[0]!.id, sectionId = page(ws, dayId).sections.find(s => s.kind === kind)!.id, op = 'paste-op'
  ws = ok(ws, { type: 'paste-links', pageId: dayId, sectionId, today: day, items: [{ url, pageId: 'link', cardBlockId: 'card', lineType: 'bulletListItem' }] }, op)
  const p = page(ws, dayId)
  ws = ok(ws, { type: 'save-editor', pageId: dayId, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: 'card', type: 'pageLink', props: { pageId: 'link' } }]) })
  return { ws, dayId, op }
}
const preview = (dayId: string, title: string | null, description: string | null, over: Partial<Extract<Action, { type: 'apply-link-preview' }>> = {}): Action =>
  ({ type: 'apply-link-preview', parentPageId: dayId, cardBlockId: 'card', pageId: 'link', url, title, description, ...over })
const body = (ws: Workspace) => editorSeed(page(ws, 'link'), ws).map(n => `${n.type}:${inlineText(n.content)}`)

let {ws, dayId, op}=pasted();
ws=ok(ws,preview(dayId,'Title','Description'));
const p=page(ws,'link');
ws=ok(ws,{type:'save-editor',pageId:'link',expectedContent:pageContentKey(p),document:JSON.stringify(editorSeed(p,ws).map((n,i)=>i===0?{...n,type:'bulletListItem'}:n))});
console.log('after user converts quote',body(ws));
const result=run(ws,{type:'undo-paste-links',pageId:dayId,operationId:op,today:day});
console.log('after paste Undo',result.receipt.message, 'page exists?',result.workspace.pages.some(p=>p.id==='link'));
assert.ok(result.workspace.pages.some(p=>p.id==='link'),'User changed quote to bullet: page must be kept');
