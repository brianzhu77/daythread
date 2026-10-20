import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView, pasteRecords } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { defaultLinkTitle, urlKey } from '../src/domain/url-key.ts'
import { undoCards } from '../src/domain/link-paste.ts'
import { linkedFrom, trashBatches, visiblePages } from '../src/domain/page-tree.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

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

test('urlKey: N-4 exactly, built from the raw text', () => {
  const k = urlKey
  assert.equal(k('https://CalmTech.com'), 'https://calmtech.com/')
  assert.equal(k(' https://calmtech.com:443/ '), 'https://calmtech.com/')
  assert.notEqual(k('http://calmtech.com/'), k('https://calmtech.com/'))
  assert.equal(k('https://calmtech.com/Book'), 'https://calmtech.com/Book')
  assert.notEqual(k('https://x.com/a?b=1&c=2'), k('https://x.com/a?c=2&b=1'))
  assert.notEqual(k('https://x.com/a#intro'), k('https://x.com/a'))
  assert.notEqual(k('https://x.com/a?utm_source=n'), k('https://x.com/a'))
  assert.equal(k('https://x.com?a=1'), 'https://x.com/?a=1')
  assert.equal(k('https://x.com#f'), 'https://x.com/#f')
  assert.equal(k('https://X.com:8080/A'), 'https://x.com:8080/A')
  assert.equal(k('http://x.com:443/'), 'http://x.com:443/')
  assert.equal(k('HTTP://x.com:80'), 'http://x.com/')
  assert.equal(k('https://User@X.com/p'), 'https://User@x.com/p')
  // Kept as typed, not normalised: an escaped and an unescaped path are two keys.
  assert.notEqual(k('https://x.com/%E5%A4%A7'), k('https://x.com/大'))
  // The platform parser would rewrite these; the key doesn't.
  assert.equal(k('https://x.com/a/../b'), 'https://x.com/a/../b')
  assert.equal(k('https://x.com/a b'), null)
  for (const bad of ['mailto:a@x.com', 'file:///etc', 'javascript:alert(1)', 'ftp://x.com', 'https://', 'x.com']) assert.equal(k(bad), null, bad)
})

test('defaultLinkTitle: no scheme or www., decoded, no trailing /, query and fragment kept', () => {
  assert.equal(defaultLinkTitle('https://www.xiachufang.com/recipe/10324/'), 'xiachufang.com/recipe/10324')
  assert.equal(defaultLinkTitle('https://zh.wikipedia.org/wiki/%E5%A4%A7%E9%85%B1%E6%B1%A4'), 'zh.wikipedia.org/wiki/大酱汤')
  assert.equal(defaultLinkTitle('https://youtube.com/watch?v=abc#t=10'), 'youtube.com/watch?v=abc#t=10')
  assert.equal(defaultLinkTitle('http://x.com/%E5%ZZ'), 'x.com/%E5%ZZ')
})

test('made: a child of the page pasted into, titled from the URL, empty, with the raw URL; the day is in Linked from', () => {
  const { ws: start, d2 } = days()
  const { ws, target } = paste(start, d2, ['https://www.Xiachufang.com/recipe/10324'])
  const p = page(ws, target(0))!
  assert.equal(p.parentId, d2)
  assert.equal(p.url, 'https://www.Xiachufang.com/recipe/10324')
  assert.equal(p.title, 'Xiachufang.com/recipe/10324')
  assert.equal(p.type, 'document')
  assert.ok(p.sections.every(s => s.blocks.every(b => !b.text)))
  assert.deepEqual(linkedFrom(ws, p.id).map(e => e.page.id), [d2])
  assert.equal(ws.materials.length, 0, 'pasted in Notes: no follow-up record')
})

test('reused: the same key on another day, or twice in one paste → one page, first parent kept, both days link to it', () => {
  const { ws: start, d1, d2 } = days()
  const first = paste(start, d1, ['https://calmtech.com/book'])
  const pageId = first.target(0)
  const second = paste(first.ws, d2, ['https://CALMTECH.com:443/book', 'https://calmtech.com/book'])
  assert.equal(second.target(0), pageId)
  assert.equal(second.target(1), pageId)
  const ws = second.ws
  assert.equal(ws.pages.filter(p => p.url).length, 1)
  assert.equal(page(ws, pageId)!.parentId, d1)
  assert.equal(page(ws, pageId)!.url, 'https://calmtech.com/book', 'the page shows the URL from the first paste')
  assert.deepEqual(pasteRecords(page(ws, d2)!, second.op).map(r => r.outcome), ['reused', 'reused'])
  assert.deepEqual(linkedFrom(ws, pageId).map(e => e.page.id).sort(), [d1, d2].sort())
})

test('restored: exactly what its own Restore brings back; a subpage deleted earlier stays; parent in trash → top level', () => {
  const { ws: base, d2 } = days()
  const start = ok(base, { type: 'create-document', title: 'Reading', body: '', pageId: 'P' }), d1 = 'P'
  let { ws, target } = paste(start, d1, ['https://a.example/'])
  const L = target(0)
  ws = ok(ws, { type: 'create-document', title: 'Child', body: '', pageId: 'child', parentId: L })
  ws = ok(ws, { type: 'create-document', title: 'Old child', body: '', pageId: 'old', parentId: L })
  ws = ok(ws, { type: 'delete-page', pageId: 'old', at: '2026-10-20T10:00:00.000Z' }, 'del-old')
  ws = ok(ws, { type: 'delete-page', pageId: L, at: '2026-10-20T11:00:00.000Z' }, 'del-L')
  ws = ok(ws, { type: 'delete-page', pageId: d1, at: '2026-10-20T12:00:00.000Z' }, 'del-parent')
  const again = paste(ws, d2, ['https://a.example'])
  ws = again.ws
  assert.equal(again.target(0), L)
  const r = pasteRecords(page(ws, d2)!, again.op)[0]!
  assert.equal(r.outcome, 'restored')
  assert.deepEqual(r.restored!.map(e => e.pageId).sort(), [L, 'child'].sort())
  assert.ok(!page(ws, L)!.trashedAt && !page(ws, 'child')!.trashedAt)
  assert.ok(page(ws, 'old')!.trashedAt, 'deleted earlier on its own: stays in the trash')
  assert.equal(page(ws, L)!.parentId, undefined, 'its old parent is in the trash: top level')
  assert.equal(r.restored!.find(e => e.pageId === L)!.parentBefore, d1)
})

test('Good Stuffs: a follow-up record matched by key; another day adds a save; Done → To sort; Notes adds none', () => {
  const { ws: start, d1, d2 } = days()
  let { ws } = paste(start, d1, ['https://gs.example/a'], { kind: 'good-stuffs' })
  assert.equal(ws.materials.length, 1)
  const m = ws.materials[0]!
  assert.equal(m.url, 'https://gs.example/a')
  assert.equal(m.sources.length, 1)
  ws = ok(ws, { type: 'review-material', materialId: m.id, decision: 'done', date: day2 })
  ws = paste(ws, d2, ['https://GS.example/a'], { kind: 'good-stuffs' }).ws
  assert.equal(ws.materials.length, 1)
  assert.equal(ws.materials[0]!.sources.length, 2)
  assert.equal(ws.materials[0]!.reviewState, 'pending', 'G05: saved again → To sort')
  ws = paste(ws, d2, ['https://gs.example/a']).ws
  assert.equal(ws.materials[0]!.sources.length, 2, 'a Notes paste is not a save')
})

test('a URL typed into Good Stuffs is the same record as the link page with that key, never a second one', () => {
  const { ws: start, d1, d2 } = days()
  let ws = save(start, d1, doc => { const at = doc.findIndex(n => n.id === heading(start, d1, 'good-stuffs')); return [...doc.slice(0, at + 1), line('typed', 'https://typed.example/x'), ...doc.slice(at + 1)] })
  assert.equal(ws.materials.length, 1)
  ws = paste(ws, d2, ['https://TYPED.example/x'], { kind: 'good-stuffs' }).ws
  assert.equal(ws.materials.length, 1)
  assert.equal(ws.pages.filter(p => p.url).length, 1)
  assert.equal(ws.materials[0]!.sources.length, 2)
  // And the other way round: a link page exists, then the URL is typed.
  ws = paste(ws, d2, ['https://other.example/']).ws
  ws = save(ws, d1, doc => { const at = doc.findIndex(n => n.id === heading(ws, d1, 'good-stuffs')); return [...doc.slice(0, at + 1), line('typed2', 'https://other.example'), ...doc.slice(at + 1)] })
  assert.equal(ws.materials.filter(m => urlKey(m.url) === 'https://other.example/').length, 1)
  assert.equal(ws.pages.filter(p => p.url && urlKey(p.url) === 'https://other.example/').length, 1)
})

test('replay, retry under another operation id, a stale revision, a bad URL, a page id in use', () => {
  const { ws: start, d2 } = days()
  const action: Action = { type: 'paste-links', pageId: d2, today: day2, items: [{ url: 'https://r.example/', pageId: 'P1', cardBlockId: 'C1', lineType: 'paragraph' }] }
  const a = run(start, action, 'op-1')
  const replay = run(a.workspace, action, 'op-1')
  assert.equal(replay.workspace.revision, a.workspace.revision)
  const retry = ok(a.workspace, action, 'op-2')
  assert.equal(retry.pages.filter(p => p.url).length, 1)
  assert.equal(pasteRecords(page(retry, d2)!, 'op-1').length, 1, 'the first outcome stands')
  fails(a.workspace, { ...action, items: [{ ...action.items[0]!, url: 'https://other.example/' }] }, /another link/, 'op-3')
  assert.throws(() => applyCommand(a.workspace, { operationId: 'op-4', expectedRevision: start.revision, action: { ...action, items: [{ url: 'https://s.example/', pageId: 'P2', cardBlockId: 'C2', lineType: 'paragraph' }] } }), /Saved elsewhere/)
  fails(start, { ...action, items: [{ url: 'mailto:a@b.c', pageId: 'P3', cardBlockId: 'C3', lineType: 'paragraph' }] }, /http\(s\)/)
  fails(start, { ...action, items: [{ url: 'https://n.example/', pageId: d2, cardBlockId: 'C4', lineType: 'paragraph' }] }, /already in use/)
  assert.equal(commandSchema.safeParse({ operationId: 'x', expectedRevision: 0, action: { ...action, items: [{ ...action.items[0]!, lineType: 'task' }] } }).success, false, 'never a task row')
})

test('two devices: the second paste of a new URL lands on the first one\'s page', () => {
  const { ws: start, d1, d2 } = days()
  const a = ok(start, { type: 'paste-links', pageId: d1, today: day2, items: [{ url: 'https://twice.example/', pageId: 'A', cardBlockId: 'CA', lineType: 'paragraph' }] })
  // Device B chose its own page id; its command is retried on the fresh workspace.
  const b = ok(a, { type: 'paste-links', pageId: d2, today: day2, items: [{ url: 'https://twice.example', pageId: 'B', cardBlockId: 'CB', lineType: 'paragraph' }] })
  assert.equal(b.pages.filter(p => p.url).length, 1)
  assert.equal(page(b, 'B'), undefined)
  assert.equal(page(b, d2)!.editorBlockMetadata!['paste:CB']!.linkPaste!.pageId, 'A')
})

test('Undo of a made page: the card is its URL line again (same id, same kind of line), the page is gone from Pages and Trash', () => {
  const { ws: start, d2 } = days()
  const p = paste(start, d2, ['https://u.example/'])
  const ws = undo(p.ws, d2, p.op).workspace
  assert.equal(page(ws, p.target(0)), undefined)
  assert.equal(trashBatches(ws).length, 0)
  const node = JSON.parse(page(ws, d2)!.editorJSON!).find((n: EditorNode) => n.id === p.items[0]!.cardBlockId)
  assert.equal(node.type, 'bulletListItem')
  assert.equal(JSON.stringify(node.content).includes('"href":"https://u.example/"'), true)
  const block = page(ws, d2)!.sections.flatMap(s => s.blocks).find(b => b.id === p.items[0]!.cardBlockId)!
  assert.equal(block.kind, 'paragraph')
  assert.equal(block.targetPageId, undefined)
  assert.equal(linkedFrom(ws, p.target(0)).length, 0)
  fails(ws, { type: 'undo-paste-links', pageId: d2, operationId: p.op, today: day2 }, /Nothing to undo/)
})

test('Undo: A and A on two lines → both lines back, the page deleted (its own second card isn\'t an outside reference)', () => {
  const { ws: start, d2 } = days()
  const p = paste(start, d2, ['https://aa.example/', 'https://aa.example/'])
  const ws = undo(p.ws, d2, p.op).workspace
  assert.equal(ws.pages.filter(x => x.url).length, 0)
  const doc = JSON.parse(page(ws, d2)!.editorJSON!) as EditorNode[]
  assert.equal(doc.filter(n => p.items.some(i => i.cardBlockId === n.id) && n.type === 'bulletListItem').length, 2)
})

test('Undo keeps a made page he wrote in, renamed, gave a child, or that something else links to', () => {
  const cases: [string, (ws: Workspace, id: string) => Workspace, RegExp][] = [
    ['body', (ws, id) => save(ws, id, doc => [...doc, line('w', 'my note')]), /it has your edits/],
    ['title', (ws, id) => ok(ws, { type: 'rename-page', pageId: id, title: '韩国大酱汤' }), /Kept 韩国大酱汤 · it has your edits/],
    ['child', (ws, id) => ok(ws, { type: 'create-document', title: 'c', body: '', pageId: 'kid', parentId: id }), /it has your edits/],
    ['reference', (ws, id) => ok(ws, { type: 'create-document', title: 'Other', body: '', pageId: 'other' }) && save(ok(ws, { type: 'create-document', title: 'Other', body: '', pageId: 'other' }), 'other', doc => [...doc, { id: 'x', type: 'pageLink', props: { pageId: id } }]), /linked from Other/],
  ]
  for (const [name, edit, message] of cases) {
    const { ws: start, d2 } = days()
    const p = paste(start, d2, ['https://keep.example/'])
    const r = undo(edit(p.ws, p.target(0)), d2, p.op)
    assert.match(r.receipt.message, message, name)
    assert.ok(page(r.workspace, p.target(0)), `${name}: kept`)
    const node = JSON.parse(page(r.workspace, d2)!.editorJSON!).find((n: EditorNode) => n.id === p.items[0]!.cardBlockId)
    assert.notEqual(node.type, 'pageLink', `${name}: the card is still turned back into the URL text`)
  }
})

test('Undo of a reused paste removes only that card', () => {
  const { ws: start, d1, d2 } = days()
  const first = paste(start, d1, ['https://r2.example/'])
  const second = paste(first.ws, d2, ['https://r2.example/'])
  const ws = undo(second.ws, d2, second.op).workspace
  assert.ok(page(ws, first.target(0)))
  assert.deepEqual(linkedFrom(ws, first.target(0)).map(e => e.page.id), [d1])
})

test('Undo of a restore: back in the same Trash row with its original parent; edits kept; blocked by a move or a new reference', () => {
  const setup = () => {
    const { ws: base, d2 } = days()
    const start = ok(base, { type: 'create-document', title: 'Reading', body: '', pageId: 'P' }), d1 = 'P'
    let { ws, target } = paste(start, d1, ['https://t.example/'])
    const L = target(0)
    ws = ok(ws, { type: 'create-document', title: 'Child', body: '', pageId: 'child', parentId: L })
    ws = ok(ws, { type: 'delete-page', pageId: L, at: '2026-10-20T11:00:00.000Z' }, 'del-L')
    ws = ok(ws, { type: 'delete-page', pageId: d1, at: '2026-10-20T12:00:00.000Z' }, 'del-parent')
    const again = paste(ws, d2, ['https://t.example/'])
    return { ...again, L, d1, d2 }
  }
  {
    const s = setup()
    const edited = save(s.ws, 'child', doc => [...doc, line('e', 'written while restored')])
    const ws = undo(edited, s.d2, s.op).workspace
    assert.equal(page(ws, s.L)!.trashId, 'del-L')
    assert.equal(page(ws, 'child')!.trashId, 'del-L')
    assert.equal(page(ws, s.L)!.parentId, s.d1, 'its original parent, so Restore puts it back under it')
    assert.ok(page(ws, 'child')!.sections.some(x => x.blocks.some(b => b.text === 'written while restored')))
    assert.equal(trashBatches(ws).filter(b => b.trashId === 'del-L').length, 1)
  }
  {
    const s = setup()
    const moved = ok(ok(s.ws, { type: 'create-document', title: 'Shelf', body: '', pageId: 'shelf' }), { type: 'move-page', pageId: 'child', parentId: 'shelf' })
    const r = undo(moved, s.d2, s.op)
    assert.match(r.receipt.message, /it was moved/)
    assert.ok(!page(r.workspace, s.L)!.trashedAt)
  }
  {
    const s = setup()
    let ws = ok(s.ws, { type: 'create-document', title: 'Other', body: '', pageId: 'other' })
    ws = save(ws, 'other', doc => [...doc, { id: 'ref', type: 'pageLink', props: { pageId: 'child' } }])
    const r = undo(ws, s.d2, s.op)
    assert.match(r.receipt.message, /linked from Other/, 'a new reference to a subpage of the set blocks it too')
    assert.ok(!page(r.workspace, 'child')!.trashedAt)
  }
})

test('Good Stuffs Undo removes only this save; the record goes only if this paste made it and nothing else uses it', () => {
  const { ws: start, d1, d2 } = days()
  const first = paste(start, d1, ['https://f.example/'], { kind: 'good-stuffs' })
  const second = paste(first.ws, d2, ['https://f.example/'], { kind: 'good-stuffs' })
  let ws = undo(second.ws, d1, first.op).workspace
  assert.equal(ws.materials.length, 1, 'day 2 still saves it')
  assert.deepEqual(ws.materials[0]!.sources.map(s => s.pageId), [d2])
  assert.ok(page(ws, first.target(0)), 'linked from day 2: kept')
  // With a decision instead of a second save.
  const only = paste(start, d1, ['https://g.example/'], { kind: 'good-stuffs' })
  ws = ok(only.ws, { type: 'review-material', materialId: only.ws.materials[0]!.id, decision: 'watching', date: day2, nextReviewOn: '2026-10-27' })
  const r = undo(ws, d1, only.op)
  assert.equal(r.workspace.materials.length, 1)
  assert.match(r.receipt.message, /it has your edits/)
  // Untouched: record and page both go.
  const clean = paste(start, d1, ['https://h.example/'], { kind: 'good-stuffs' })
  ws = undo(clean.ws, d1, clean.op).workspace
  assert.equal(ws.materials.length, 0)
  assert.equal(ws.pages.filter(p => p.url).length, 0)
})

test('Good Stuffs: the URL line Undo put back isn\'t collected again by a later save, until he edits it', () => {
  const { ws: start, d1 } = days()
  const p = paste(start, d1, ['https://back.example/'], { kind: 'good-stuffs' })
  let ws = undo(p.ws, d1, p.op).workspace
  ws = save(ws, d1, doc => [...doc, line('later', 'unrelated')])
  assert.equal(ws.materials.length, 0)
  const id = p.items[0]!.cardBlockId
  ws = save(ws, d1, doc => doc.map(n => n.id === id ? line(id, 'https://back.example/edited', 'bulletListItem') : n))
  assert.equal(ws.materials.length, 1, 'edited: A5 collects it as any line')
})

test('Undo: a card he deleted is skipped; none left → "Page changed · nothing was undone"', () => {
  const { ws: start, d2 } = days()
  const p = paste(start, d2, ['https://d1.example/', 'https://d2.example/'])
  let ws = save(p.ws, d2, doc => doc.filter(n => n.id !== p.items[0]!.cardBlockId))
  const r = undo(ws, d2, p.op)
  assert.equal(r.workspace.pages.filter(x => x.url).length, 0, 'both pages unused: both deleted')
  ws = save(p.ws, d2, doc => doc.filter(n => !p.items.some(i => i.cardBlockId === n.id)))
  fails(ws, { type: 'undo-paste-links', pageId: d2, operationId: p.op, today: day2 }, /Page changed · nothing was undone/)
})

test('undoCards: the same result on the server document and on a local one with more typing, nesting and a deleted card', () => {
  const card = (id: string, pageId: string, children?: EditorNode[]): EditorNode => ({ id, type: 'pageLink', props: { pageId }, ...(children ? { children } : {}) })
  const cards = [{ blockId: 'c1', pageId: 'p1', url: 'https://1.example/', lineType: 'bulletListItem' }, { blockId: 'c2', pageId: 'p2', url: 'https://2.example/', lineType: 'paragraph' }]
  const server = [line('h', 'Notes'), { ...line('b', 'parent', 'bulletListItem'), children: [card('c1', 'p1')] }, card('c2', 'p2'), card('c3', 'p9')]
  const local = [line('h', 'Notes'), { ...line('b', 'parent', 'bulletListItem'), children: [card('c1', 'p1'), line('typed', 'a note')] }, card('c3', 'p9'), line('more', 'more typing')]
  const s = undoCards(server, cards), l = undoCards(local, cards)
  assert.equal(s[1]!.children![0]!.type, 'bulletListItem')
  assert.deepEqual(s[1]!.children![0], l[1]!.children![0])
  assert.equal(s[2]!.type, 'paragraph')
  assert.equal(s[3]!.type, 'pageLink', 'a card of another paste is untouched')
  assert.deepEqual(l[1]!.children![1], line('typed', 'a note'))
  assert.equal(JSON.stringify(undoCards(server, [{ ...cards[0]!, pageId: 'other' }])), JSON.stringify(server), 'a card re-pointed since is not this paste\'s card')
})

test('the identity invariant holds over a random sequence of paste, Undo, trash, restore and typed lines', () => {
  const urls = ['https://i.example/', 'https://I.example', 'https://i.example/x', 'http://i.example/', 'https://j.example/']
  for (let seed = 1; seed <= 25; seed++) {
    let rnd = seed
    const next = (n: number) => { rnd = (rnd * 48271) % 2147483647; return rnd % n }
    let { ws, d1, d2 } = days()
    const ops: { op: string; pageId: string }[] = []
    for (let step = 0; step < 30; step++) {
      const choice = next(5), on = next(2) ? d1 : d2
      try {
        if (choice === 0 || choice === 1) {
          const p = paste(ws, on, [urls[next(urls.length)]!], { kind: next(2) ? 'good-stuffs' : 'notes' })
          ws = p.ws; ops.push({ op: p.op, pageId: on })
        } else if (choice === 2 && ops.length) {
          const o = ops[next(ops.length)]!
          ws = undo(ws, o.pageId, o.op).workspace
        } else if (choice === 3) {
          const live = ws.pages.filter(p => p.url && !p.trashedAt)
          if (live.length) ws = ok(ws, { type: 'delete-page', pageId: live[next(live.length)]!.id, at: '2026-10-20T12:00:00.000Z' })
        } else {
          ws = save(ws, on, doc => [...doc, line(`t${seed}-${step}`, urls[next(urls.length)]!)])
        }
      } catch (error) { if (!(error instanceof Error) || !/Nothing to undo|nothing was undone|in trash|not found/i.test(error.message)) throw error }
      const keys = ws.pages.filter(p => p.url).map(p => urlKey(p.url!))
      assert.equal(new Set(keys).size, keys.length, `seed ${seed} step ${step}: one page per key`)
      const mkeys = ws.materials.map(m => urlKey(m.url))
      assert.equal(new Set(mkeys).size, mkeys.length, `seed ${seed} step ${step}: one record per key`)
      for (const p of ws.pages) if (p.parentId) assert.ok(page(ws, p.parentId), `seed ${seed}: no dangling parent`)
    }
  }
})

test('the review still lists a Good Stuffs link page two days later; Bring to today doesn\'t offer the card', () => {
  const { ws: start, d1 } = days()
  let ws = paste(start, d1, ['https://review.example/'], { kind: 'good-stuffs', today: day1 }).ws
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-21' })
  const view = getDayView(ws, '2026-10-21')
  assert.equal(view.materialReview.length, 1)
  assert.equal(getDayView(ws, day2).handoffBlocks.some(b => b.block.kind === 'reference'), false)
  assert.ok(visiblePages(ws).some(p => p.url))
})

test('Ratchet #82: a made page also saved by a typed Good Stuffs line elsewhere is kept by Undo', () => {
  const { ws: start, d1, d2 } = days()
  const p = paste(start, d1, ['https://typed-later.example/'], { kind: 'good-stuffs' })
  const ws = save(p.ws, d2, doc => { const at = doc.findIndex(n => n.id === heading(p.ws, d2, 'good-stuffs')); return [...doc.slice(0, at + 1), line('typed', 'https://typed-later.example/'), ...doc.slice(at + 1)] })
  assert.equal(ws.materials[0]!.sources.length, 2)
  const r = undo(ws, d1, p.op)
  assert.ok(page(r.workspace, p.target(0)), 'the page stays: another save uses it')
  assert.match(r.receipt.message, /linked from/)
  assert.deepEqual(r.workspace.materials[0]!.sources.map(s => s.pageId), [d2])
})

test('Ratchet #82 (A5): changing only the host\'s case of a typed Good Stuffs URL keeps its saved item', () => {
  const { ws: start, d1 } = days()
  let ws = save(start, d1, doc => { const at = doc.findIndex(n => n.id === heading(start, d1, 'good-stuffs')); return [...doc.slice(0, at + 1), line('h', 'https://EXAMPLE.com/a'), ...doc.slice(at + 1)] })
  const id = ws.materials[0]!.id
  ws = save(ws, d1, doc => doc.map(n => n.id === 'h' ? line('h', 'https://example.com/a') : n))
  assert.equal(ws.materials.length, 1)
  assert.equal(ws.materials[0]!.id, id)
  assert.equal(ws.materials[0]!.url, 'https://example.com/a')
  assert.equal(page(ws, d1)!.sections.flatMap(s => s.blocks).find(b => b.id === 'h')!.materialId, id)
})

test('Lead aa5d532f: a link copied as text keeps its text as the first title; Undo still deletes it unless renamed', () => {
  const { ws: start, d2 } = days()
  const item = { url: 'https://www.xiachufang.com/recipe/1/', pageId: 'T1', cardBlockId: 'CT1', lineType: 'paragraph', title: ' 韩国大酱汤 (正宗) ' }
  let ws = ok(start, { type: 'paste-links', pageId: d2, today: day2, items: [item] }, 'op-t')
  assert.equal(page(ws, 'T1')!.title, '韩国大酱汤 (正宗)')
  ws = save(ws, d2, doc => [...doc, { id: 'CT1', type: 'pageLink', props: { pageId: 'T1' } }])
  assert.equal(page(undo(ws, d2, 'op-t').workspace, 'T1'), undefined)
  const renamed = ok(ws, { type: 'rename-page', pageId: 'T1', title: 'Doenjang jjigae' })
  assert.match(undo(renamed, d2, 'op-t').receipt.message, /it has your edits/)
  // The text is the URL itself: the URL default.
  const plain = ok(start, { type: 'paste-links', pageId: d2, today: day2, items: [{ ...item, pageId: 'T2', cardBlockId: 'CT2', title: item.url }] })
  assert.equal(page(plain, 'T2')!.title, 'xiachufang.com/recipe/1')
})
