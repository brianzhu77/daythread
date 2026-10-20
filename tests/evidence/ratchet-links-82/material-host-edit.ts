import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView, pasteRecords } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { defaultLinkTitle, urlKey } from '../../../src/domain/url-key.ts'
import { undoCards } from '../../../src/domain/link-paste.ts'
import { linkedFrom, trashBatches, visiblePages } from '../../../src/domain/page-tree.ts'
import { commandSchema } from '../../../src/domain/command-schema.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

// A2 paste a URL → a page (docs/plan/a2-url-page.md @ 46ba81b, Ratchet #81; states link-pages-states.md).
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action, operationId?: string) => run(ws, action, operationId).workspace
const fails = (ws: Workspace, action: Action, pattern: RegExp, operationId?: string) => assert.throws(() => run(ws, action, operationId), pattern)
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)
const day1 = '2026-10-19', day2 = '2026-10-20'
const line = (id: string, text: string, type = 'paragraph'): EditorNode => ({ id, type, content: [{ type: 'text', text, styles: {} }] })
function save(ws: Workspace, pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) {
  const p = page(ws, pageId)!
  return ok(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
}
const dayId = (ws: Workspace, d: string) => ws.pages.find(p => p.type === 'daily' && p.date === d)!.id
const heading = (ws: Workspace, pageId: string, kind: string) => page(ws, pageId)!.sections.find(s => s.kind === kind)!.id

/**
 * What the browser does: cards go in after the section's heading (here: at its end), then one paste-links for all of
 * them, then the editor's save of the cards. Card ids are `card:<n>`, page ids `page:<n>` unless the browser already
 * knows the page for that key.
 */
function paste(ws: Workspace, pageId: string, urls: string[], opts: { kind?: string; op?: string; lineType?: string; today?: string } = {}) {
  const op = opts.op ?? crypto.randomUUID(), kind = opts.kind ?? 'notes'
  const sectionId = heading(ws, pageId, kind)
  const items = urls.map((url, i) => {
    const known = ws.pages.find(p => p.url && urlKey(p.url) === urlKey(url))
    return { url, pageId: known?.id ?? `page:${op}:${i}`, cardBlockId: `card:${op}:${i}`, lineType: opts.lineType ?? 'bulletListItem' }
  })
  ws = ok(ws, { type: 'paste-links', pageId, sectionId, today: opts.today ?? day2, items }, op)
  const target = (i: number) => pasteRecords(page(ws, pageId)!, op).find(r => r.cardBlockId === items[i]!.cardBlockId)!.pageId
  ws = save(ws, pageId, doc => {
    const range = doc.findIndex(n => n.id === sectionId)
    let end = range + 1
    while (end < doc.length && doc[end]!.type !== 'heading') end++
    return [...doc.slice(0, end), ...items.map((it, i) => ({ id: it.cardBlockId, type: 'pageLink', props: { pageId: target(i) } })), ...doc.slice(end)]
  })
  return { ws, op, items, target }
}
const undo = (ws: Workspace, pageId: string, op: string) => run(ws, { type: 'undo-paste-links', pageId, operationId: op, today: day2 })
function days() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: day1 })
  ws = ok(ws, { type: 'ensure-day', date: day2 })
  return { ws, d1: dayId(ws, day1), d2: dayId(ws, day2) }
}


let {ws,d1}=days();const gs=heading(ws,d1,'good-stuffs');ws=save(ws,d1,doc=>{const at=doc.findIndex(n=>n.id===gs);return [...doc.slice(0,at+1),line('typed-gs','https://EXAMPLE.com/a'),...doc.slice(at+1)]});console.log('before',JSON.stringify(ws.materials));ws=save(ws,d1,doc=>doc.map(n=>n.id==='typed-gs'?line('typed-gs','https://example.com/a'):n));console.log('after',JSON.stringify(ws.materials));console.log('block',JSON.stringify(page(ws,d1)!.sections.find(s=>s.id===gs)));assert.equal(ws.materials.length,1,'editing only host case must keep the same saved item');
