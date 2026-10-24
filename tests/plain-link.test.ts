import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B44 §4a (Lead 17ab8da6): a link pasted and kept plain is still remembered, with no page; it goes with its line.
const day = '2026-10-23', url = 'https://sspai.com/post/12345'
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action) => run(ws, action).workspace
const link = (id: string, href = url): EditorNode => ({ id, type: 'bulletListItem', props: {}, content: [{ type: 'link', href, content: [{ type: 'text', text: href, styles: {} }] }] as never, children: [] })
function setup() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: day })
  const dayId = ws.pages[0]!.id
  const save = (edit: (nodes: EditorNode[]) => EditorNode[], keptPlainLinks?: { blockId: string; url: string }[]) => { const p = ws.pages.find(x => x.id === dayId)!; ws = ok(ws, { type: 'save-editor', pageId: dayId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))), ...(keptPlainLinks ? { keptPlainLinks } : {}) }) }
  return { dayId, save, run: (a: Action) => { ws = ok(ws, a) }, get ws() { return ws } }
}
const item = (ws: Workspace) => ws.materials.find(m => m.url === url)

test('a kept plain link is remembered with no page, its title the URL, on its line', () => {
  const s = setup()
  s.save(n => [...n, link('l1')], [{ blockId: 'l1', url }])
  const m = item(s.ws)!
  assert.equal(m.title, url)
  assert.deepEqual(m.sources, [{ pageId: s.dayId, blockId: 'l1', note: '', plain: true }])
  assert.equal(s.ws.pages.some(p => p.url === url), false, 'no page')
})

test('deleting its line (or ⌘Z of the paste, which takes the text away) removes it', () => {
  for (const edit of [(n: EditorNode[]) => n.filter(x => x.id !== 'l1'), (n: EditorNode[]) => n.map(x => x.id === 'l1' ? { ...x, content: [] } : x)]) {
    const s = setup()
    s.save(n => [...n, link('l1')], [{ blockId: 'l1', url }])
    s.save(edit)
    assert.equal(item(s.ws), undefined)
  }
})

test('kept while another line holds the link, or a page has it, or he acted on it', () => {
  const a = setup()
  a.save(n => [...n, link('l1'), link('l2')], [{ blockId: 'l1', url }])
  a.save(n => n.filter(x => x.id !== 'l1'))
  assert.deepEqual(item(a.ws)?.sources.map(x => x.blockId), ['l2'], 'moves to the other line')
  const b = setup()
  b.save(n => [...n, link('l1')], [{ blockId: 'l1', url }])
  b.run({ type: 'create-document', title: 'Saved', body: '', pageId: 'lp' })
  const ws = structuredClone(b.ws); ws.pages.find(p => p.id === 'lp')!.url = url
  const c = run(ws, { type: 'save-editor', pageId: b.dayId, expectedContent: pageContentKey(ws.pages.find(p => p.id === b.dayId)!), document: JSON.stringify(editorSeed(ws.pages.find(p => p.id === b.dayId)!, ws).filter(x => x.id !== 'l1')) }).workspace
  assert.ok(c.materials.find(m => m.url === url), 'a page has it')
})

test('Bookmark page: the card that replaces the line keeps it (one item), and the line Undo puts back keeps it too', () => {
  const s = setup()
  s.save(n => [...n, link('l1')], [{ blockId: 'l1', url }])
  const sectionId = s.ws.pages[0]!.sections.find(x => x.kind === 'notes')!.id
  s.run({ type: 'paste-links', pageId: s.dayId, sectionId, today: day, items: [{ url, pageId: 'lp', cardBlockId: 'card', lineType: 'bulletListItem' }] })
  s.save(n => n.map(x => x.id === 'l1' ? { id: 'card', type: 'pageLink', props: { pageId: 'lp', url, line: 'bulletListItem' }, children: [] } : x))
  assert.equal(s.ws.materials.filter(m => m.url === url).length, 1, 'one item for the link')
  assert.deepEqual(item(s.ws)?.sources.map(x => x.blockId), ['card'])
  // Undo of the bookmark: the card becomes the URL line again.
  s.save(n => n.map(x => x.id === 'card' ? { id: 'back', type: 'bulletListItem', props: {}, content: url, children: [] } : x))
  assert.deepEqual(item(s.ws)?.sources.map(x => x.blockId), ['back'])
})

test('a link he already had keeps its item untouched: no re-save, and it isn\'t removed with the pasted line', () => {
  const s = setup()
  const gs = s.ws.pages[0]!.sections.find(x => x.kind === 'good-stuffs')!.id
  s.run({ type: 'add-text', pageId: s.dayId, sectionId: gs, text: url })
  const before = structuredClone(item(s.ws)!)
  s.save(n => [...n, link('l9')], [{ blockId: 'l9', url }])
  assert.equal(item(s.ws)!.reviewState, before.reviewState)
  assert.equal(item(s.ws)!.decisions?.length ?? 0, before.decisions?.length ?? 0, 'not "saved again"')
  s.save(n => n.filter(x => x.id !== 'l9'))
  assert.ok(item(s.ws), 'the Good Stuffs save keeps it')
})

test('a link pasted into Good Stuffs and kept is a deliberate save: not plain, kept when its line goes (Ratchet)', () => {
  const s = setup()
  const into = (n: EditorNode[]) => { const at = n.findIndex(x => x.id === `day:${day}:good-stuffs`); return [...n.slice(0, at + 1), link('g1'), ...n.slice(at + 1)] }
  s.save(into, [{ blockId: 'g1', url }])
  assert.deepEqual(item(s.ws)?.sources, [{ pageId: s.dayId, blockId: 'g1', note: '' }], 'not plain')
  s.save(n => n.filter(x => x.id !== 'g1'))
  assert.ok(item(s.ws), 'deleting the line keeps the save')
})

test('the save that carries the line carries the link: a later save (offline, then back) still remembers it, once', () => {
  const s = setup()
  s.save(n => [...n, link('l1')])
  assert.equal(item(s.ws), undefined)
  s.save(n => n, [{ blockId: 'l1', url }])
  s.save(n => n, [{ blockId: 'l1', url }])
  assert.deepEqual(item(s.ws)?.sources, [{ pageId: s.dayId, blockId: 'l1', note: '', plain: true }], 'one record, one line')
})

test('a kept link whose line this save doesn\'t hold is left out (undone, or already a card)', () => {
  const s = setup()
  s.save(n => [...n, { id: 'l1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'no link here', styles: {} }], children: [] } as EditorNode], [{ blockId: 'l1', url }, { blockId: 'gone', url }])
  assert.equal(item(s.ws), undefined)
})

test('a tab still on b358ac8 sends save-plain-link before its save: still remembered, and still goes with its line', () => {
  const s = setup()
  s.run({ type: 'save-plain-link', pageId: s.dayId, items: [{ blockId: 'l1', url }] })
  s.save(n => [...n, link('l1')])
  assert.deepEqual(item(s.ws)?.sources, [{ pageId: s.dayId, blockId: 'l1', note: '', plain: true }])
  s.save(n => n.filter(x => x.id !== 'l1'))
  assert.equal(item(s.ws), undefined)
})
