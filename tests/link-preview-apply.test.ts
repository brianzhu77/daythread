import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, pasteRecords } from '../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { defaultLinkTitle } from '../src/domain/url-key.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

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

test('an untouched made page takes the title and a quote of the description', () => {
  let { ws, dayId } = pasted()
  assert.equal(page(ws, 'link').title, defaultLinkTitle(url))
  ws = ok(ws, preview(dayId, 'How to be more ambitious', 'A tutorial for humans with models'))
  assert.equal(page(ws, 'link').title, 'How to be more ambitious')
  assert.deepEqual(body(ws), ['quote:A tutorial for humans with models', 'paragraph:'])
  assert.equal(pasteRecords(page(ws, dayId), 'paste-op')[0]!.title, 'How to be more ambitious')
})

test('the paste\'s Undo still removes the page: the fetched title and quote aren\'t his edits', () => {
  let { ws, dayId, op } = pasted()
  ws = ok(ws, preview(dayId, 'How to be more ambitious', 'A tutorial'))
  ws = ok(ws, { type: 'undo-paste-links', pageId: dayId, operationId: op, today: day })
  assert.equal(ws.pages.some(p => p.id === 'link'), false)
})

test('after he edits the quote, the paste\'s Undo keeps the page ("has your edits")', () => {
  let { ws, dayId, op } = pasted()
  ws = ok(ws, preview(dayId, 'How to be more ambitious', 'A tutorial'))
  const p = page(ws, 'link')
  ws = ok(ws, { type: 'save-editor', pageId: 'link', expectedContent: pageContentKey(p), document: JSON.stringify(editorSeed(p, ws).map((n, i) => i === 0 ? { ...n, content: 'A tutorial, and my note' } : n)) })
  const r = run(ws, { type: 'undo-paste-links', pageId: dayId, operationId: op, today: day })
  assert.equal(r.workspace.pages.some(x => x.id === 'link'), true)
  assert.match(r.receipt.message, /has your edits/)
})

test('a description that adds nothing gets no quote; no title and no description changes nothing', () => {
  let { ws, dayId } = pasted()
  ws = ok(ws, preview(dayId, 'Same words', 'same words'))
  assert.equal(page(ws, 'link').title, 'Same words')
  assert.deepEqual(body(ws), ['paragraph:'])
  const fresh = pasted()
  const r = run(fresh.ws, preview(fresh.dayId, null, '  '))
  assert.equal(r.receipt.message, 'Link page unchanged')
  assert.equal(page(r.workspace, 'link').title, defaultLinkTitle(url))
})

test('a late result does nothing: after the paste\'s Undo, in the trash, renamed, typed in, another URL, or twice', () => {
  const unchanged = (ws: Workspace, action: Action) => assert.equal(run(ws, action).receipt.message, 'Link page unchanged')
  { const { ws, dayId, op } = pasted(); const undone = ok(ws, { type: 'undo-paste-links', pageId: dayId, operationId: op, today: day }); unchanged(undone, preview(dayId, 'T', 'D')) }
  // In the trash, the app's guard on trashed pages refuses it outright: also nothing changed (the server function ignores it).
  { const { ws, dayId } = pasted(); const trashed = ok(ws, { type: 'delete-page', pageId: 'link', at: '2026-10-23T10:00:00.000Z' }); assert.throws(() => run(trashed, preview(dayId, 'T', 'D')), /trash/) }
  { const { ws, dayId } = pasted(); unchanged(ok(ws, { type: 'rename-page', pageId: 'link', title: 'My name' }), preview(dayId, 'T', 'D')) }
  { const { ws, dayId } = pasted(); const p = page(ws, 'link')
    unchanged(ok(ws, { type: 'save-editor', pageId: 'link', expectedContent: pageContentKey(p), document: JSON.stringify([{ id: 'x', type: 'paragraph', content: 'my words' }]) }), preview(dayId, 'T', 'D')) }
  { const { ws, dayId } = pasted(); unchanged(ws, preview(dayId, 'T', 'D', { url: 'https://other.example/' })) }
  { const { ws, dayId } = pasted(); unchanged(ws, preview(dayId, 'T', 'D', { cardBlockId: 'not-the-card' })) }
  { const { ws, dayId } = pasted(); const once = ok(ws, preview(dayId, 'T', 'D')); unchanged(once, preview(dayId, 'T2', 'D2')) }
})

test('Good Stuffs: the paste\'s follow-up record takes the title too', () => {
  let { ws, dayId } = pasted('good-stuffs')
  ws = ok(ws, preview(dayId, 'How to be more ambitious', null))
  assert.equal(ws.materials.find(m => m.url === url)?.title, 'How to be more ambitious')
})

test('the result is text: it never adds markup, links or a second line', () => {
  let { ws, dayId } = pasted()
  ws = ok(ws, preview(dayId, '<b>Title</b>', '[[Not a link]] <script>x</script>\nsecond line'))
  assert.equal(page(ws, 'link').title, '<b>Title</b>', 'kept as literal text (the fetcher already strips tags)')
  const quote = JSON.parse(page(ws, 'link').editorJSON!)[0] as EditorNode
  assert.equal(typeof quote.content, 'string', 'plain text content, no inline links')
  assert.equal(quote.content, '[[Not a link]] <script>x</script> second line')
})

test('the quote turned into a bullet, or formatted, with the same words: Undo keeps the page (Ratchet a35f2026)', () => {
  for (const edit of [(n: EditorNode) => ({ ...n, type: 'bulletListItem' }), (n: EditorNode) => ({ ...n, content: [{ type: 'text', text: inlineText(n.content), styles: { bold: true } }] })]) {
    let { ws, dayId, op } = pasted()
    ws = ok(ws, preview(dayId, 'How to be more ambitious', 'A tutorial'))
    const p = page(ws, 'link')
    ws = ok(ws, { type: 'save-editor', pageId: 'link', expectedContent: pageContentKey(p), document: JSON.stringify(editorSeed(p, ws).map((n, i) => i === 0 ? edit(n) : n)) })
    const r = run(ws, { type: 'undo-paste-links', pageId: dayId, operationId: op, today: day })
    assert.equal(r.workspace.pages.some(x => x.id === 'link'), true)
    assert.match(r.receipt.message, /has your edits/)
  }
})
