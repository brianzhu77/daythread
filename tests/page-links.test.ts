import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, pasteRecords } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { linkedFrom, recentPages } from '../src/domain/page-tree.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

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

test('a link is a reference: refs with identity and time, the line\'s text reads the title, Linked from lists the page', () => {
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, line('l1', text('做法参考 '), ref('R', 'r1'), text(' 里的配料'))])
  const b = blockOf(ws, d20, 'l1')
  assert.deepEqual(b.refs, [{ refId: 'r1', pageId: 'R', at: ws.revision, title: '韩国大酱汤' }])
  assert.equal(b.text, '做法参考 韩国大酱汤 里的配料')
  assert.deepEqual(from(ws, 'R'), [d20])
})

test('the time is kept: an ordinary save, a rename, a move, editing words in the line; Undo of a delete brings its old time back', () => {
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, line('l1', text('see '), ref('R', 'r1'))])
  const at = blockOf(ws, d20, 'l1').refs![0]!.at
  ws = save(ws, d20, doc => [...doc, line('other', text('more'))])
  ws = ok(ws, { type: 'rename-page', pageId: 'R', title: 'Doenjang' })
  ws = ok(ws, { type: 'move-page', pageId: 'R', parentId: 'D' })
  ws = save(ws, d20, doc => doc.map(n => n.id === 'l1' ? line('l1', text('read '), ref('R', 'r1'), text(' tonight')) : n))
  assert.equal(blockOf(ws, d20, 'l1').refs![0]!.at, at)
  assert.equal(blockOf(ws, d20, 'l1').refs![0]!.title, 'Doenjang')
  // A rename doesn't turn the saved line into text when the editor reopens it.
  // Force the seed to rebuild from sections (as after a server-side edit), then rename: the line keeps its link.
  const renamed = ok(ws, { type: 'rename-page', pageId: 'R', title: 'Renamed again' })
  const stale = { ...page(renamed, d20), editorSections: 'out of step' }
  const seeded = editorSeed(stale, renamed).find(n => n.id === 'l1')!
  assert.ok(JSON.stringify(seeded.content).includes('"pageRef"'), JSON.stringify(seeded))
  const deleted = save(ws, d20, doc => doc.filter(n => n.id !== 'l1'))
  assert.deepEqual(from(deleted, 'R'), [])
  const back = save(deleted, d20, doc => [...doc, line('l1', text('read '), ref('R', 'r1'))])
  assert.equal(blockOf(back, d20, 'l1').refs![0]!.at, at)
})

test('identity: a cut-and-paste move to another page keeps the time either way round; a copy, or a new target, is new', () => {
  let { ws, d19, d20 } = setup()
  ws = save(ws, d19, doc => [...doc, line('l1', ref('R', 'r1'))])
  const at = blockOf(ws, d19, 'l1').refs![0]!.at
  // Paste lands first on Oct 20, then Oct 19 saves without it.
  let moved = save(ws, d20, doc => [...doc, line('m1', ref('R', 'r1'))])
  moved = save(moved, d19, doc => doc.filter(n => n.id !== 'l1'))
  assert.equal(blockOf(moved, d20, 'm1').refs![0]!.at, at)
  // The other way round: the cut saves first.
  let other = save(ws, d19, doc => doc.filter(n => n.id !== 'l1'))
  other = save(other, d20, doc => [...doc, line('m1', ref('R', 'r1'))])
  assert.equal(blockOf(other, d20, 'm1').refs![0]!.at, at)
  const copy = save(ws, d20, doc => [...doc, line('c1', ref('R', 'r2'))])
  assert.ok(blockOf(copy, d20, 'c1').refs![0]!.at > at)
  const retarget = save(ws, d19, doc => doc.map(n => n.id === 'l1' ? line('l1', ref('X', 'r1')) : n))
  assert.ok(blockOf(retarget, d19, 'l1').refs![0]!.at > at)
})

test('cards: a card keeps its time; pointing it at another page is a new reference', () => {
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, { id: 'c', type: 'pageLink', props: { pageId: 'R' } }])
  const at = blockOf(ws, d20, 'c').at!
  ws = save(ws, d20, doc => [...doc, line('x', text('typing'))])
  assert.equal(blockOf(ws, d20, 'c').at, at)
  ws = save(ws, d20, doc => doc.map(n => n.id === 'c' ? { ...n, props: { pageId: 'X' } } : n))
  assert.ok(blockOf(ws, d20, 'c').at! > at)
})

test('B15: newest reference first; deleting the newest falls back; a move never reorders', () => {
  let { ws, d19, d20 } = setup()
  ws = save(ws, d19, doc => [...doc, line('a', ref('R', 'ra'))])
  ws = save(ws, 'D', doc => [...doc, line('b', ref('R', 'rb'))])
  ws = save(ws, d20, doc => [...doc, line('c', ref('R', 'rc'))])
  assert.deepEqual(from(ws, 'R'), [d20, 'D', d19])
  // D links again, later: it's the newest now.
  ws = save(ws, 'D', doc => [...doc, line('b2', ref('R', 'rb2'))])
  assert.deepEqual(from(ws, 'R'), ['D', d20, d19])
  // Delete D's newest: it falls back to its earlier link.
  ws = save(ws, 'D', doc => doc.filter(n => n.id !== 'b2'))
  assert.deepEqual(from(ws, 'R'), [d20, 'D', d19])
  ws = ok(ws, { type: 'move-page', pageId: 'D', parentId: 'X' })
  ws = ok(ws, { type: 'move-page', pageId: 'R', parentId: 'X' })
  assert.deepEqual(from(ws, 'R'), [d20, 'D', d19])
})

test('save-editor refuses: a new link to a trashed page, a link in a task row, the same refId twice, a made-up page', () => {
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, line('keep', ref('X', 'rx'))])
  ws = ok(ws, { type: 'delete-page', pageId: 'X', at: '2026-10-20T12:00:00.000Z' })
  refuses(ws, d20, doc => [...doc, line('n', ref('X', 'new'))], /in trash/)
  // The link that already pointed there stays (shown trashed).
  ws = save(ws, d20, doc => [...doc, line('t', text('typing'))])
  assert.equal(blockOf(ws, d20, 'keep').refs![0]!.pageId, 'X')
  refuses(ws, d20, doc => [...doc, { id: 'task', type: 'task', props: { taskId: 'editor-task:task', role: 'reference' }, content: [text('call '), ref('R', 'rt')] }], /task row/)
  refuses(ws, d20, doc => [...doc, line('d1', ref('R', 'dup')), line('d2', ref('R', 'dup'))], /twice/)
  refuses(ws, d20, doc => [...doc, line('m', ref('nope', 'rm'))], /not found/)
})

test('a pending new page: accepted with newTitle, counted once the page exists without another save, then pending clears', () => {
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, line('p', text('see '), ref('NEW', 'rp', '新页面'))])
  const r = blockOf(ws, d20, 'p').refs![0]!
  assert.equal(r.pending, true)
  assert.deepEqual(from(ws, 'NEW'), [])
  ws = ok(ws, { type: 'create-document', title: '新页面', body: '', pageId: 'NEW', parentId: d20 })
  // The day hasn't been saved again: the new page already lists it (readers go by the target).
  assert.deepEqual(linkedFrom(ws, 'NEW').map(e => [e.page.id, e.isParent]), [[d20, true]])
  ws = save(ws, d20, doc => doc.map(n => n.id === 'p' ? line('p', text('see '), ref('NEW', 'rp')) : n))
  const after = blockOf(ws, d20, 'p').refs![0]!
  assert.equal(after.pending, undefined)
  assert.equal(after.at, r.at)
})

test('A2: a new [[ link blocks Undo of a paste from deleting the page it made', () => {
  let { ws, d19, d20 } = setup()
  ws = ok(ws, { type: 'paste-links', pageId: d20, today: '2026-10-20', items: [{ url: 'https://u.example/', pageId: 'U', cardBlockId: 'cardU', lineType: 'paragraph' }] }, 'op-u')
  ws = save(ws, d20, doc => [...doc, { id: 'cardU', type: 'pageLink', props: { pageId: 'U' } }])
  ws = save(ws, d19, doc => [...doc, line('l', ref('U', 'ru'))])
  const r = run(ws, { type: 'undo-paste-links', pageId: d20, operationId: 'op-u', today: '2026-10-20' })
  assert.match(r.receipt.message, /linked from/)
  assert.ok(page(r.workspace, 'U'))
  assert.equal(pasteRecords(page(ws, d20), 'op-u').length, 1)
})

test('recent pages: by the newest reference to them, the same for everyone; never the current page or a trashed one', () => {
  let { ws, d19, d20 } = setup()
  ws = save(ws, d19, doc => [...doc, line('a', ref('X', 'ra'))])
  ws = save(ws, d19, doc => [...doc, line('b', ref('R', 'rb'))])
  assert.deepEqual(recentPages(ws, d20).map(p => p.id).slice(0, 2), ['R', 'X'])
  assert.ok(!recentPages(ws, 'R').some(p => p.id === 'R'))
  ws = ok(ws, { type: 'delete-page', pageId: 'X', at: '2026-10-20T12:00:00.000Z' })
  assert.ok(!recentPages(ws, d20).some(p => p.id === 'X'))
})

test('Bring to today: a brought line\'s links are new references with their own refId', () => {
  let { ws, d19, d20 } = setup()
  ws = save(ws, d19, doc => { const at = doc.findIndex(n => n.id === `${d19}:notes`); return [...doc.slice(0, at + 1), line('src', text('see '), ref('R', 'r-src')), ...doc.slice(at + 1)] })
  ws = ok(ws, { type: 'bring-line', date: '2026-10-20', sourcePageId: d19, sourceBlockId: 'src' })
  const brought = page(ws, d20).sections.flatMap(s => s.blocks).find(b => b.refs?.length)!
  assert.notEqual(brought.refs![0]!.refId, 'r-src')
  assert.deepEqual(from(ws, 'R').sort(), [d19, d20].sort())
})

test('Ratchet #84 / Lead: every line type with inline content goes through the same link rules, headings included', () => {
  const types: [string, Record<string, unknown>][] = [['paragraph', {}], ['heading', { level: 3 }], ['bulletListItem', {}], ['numberedListItem', {}], ['quote', {}]]
  for (const [type, props] of types) {
    let { ws, d20 } = setup()
    const id = `${type}-line`
    ws = save(ws, d20, doc => [...doc, { id, type, props, content: [text('see '), ref('R', `r-${type}`)] }])
    const holder = type === 'heading' ? page(ws, d20).sections.find(s => s.id === id)! : blockOf(ws, d20, id)
    assert.equal(holder.refs?.[0]?.pageId, 'R', `${type}: stored as a reference`)
    assert.ok(from(ws, 'R').includes(d20), `${type}: Linked from lists the page`)
    refuses(ws, d20, doc => [...doc, { id: `${id}-dup`, type, props, content: [ref('R', `r-${type}`)] }], /twice/)
    refuses(ws, d20, doc => [...doc, { id: `${id}-bad`, type, props, content: [ref('nope', `bad-${type}`)] }], /not found/)
  }
  // The heading's title text reads the link's title, and a rename doesn't turn the heading into text when reseeded.
  let { ws, d20 } = setup()
  ws = save(ws, d20, doc => [...doc, { id: 'h', type: 'heading', props: { level: 2 }, content: [text('关于 '), ref('R', 'rh')] }])
  assert.equal(page(ws, d20).sections.find(s => s.id === 'h')!.title, '关于 韩国大酱汤')
  const renamed = ok(ws, { type: 'rename-page', pageId: 'R', title: 'Doenjang' })
  const seeded = editorSeed({ ...page(renamed, d20), editorSections: 'out of step' }, renamed).find(n => n.id === 'h')!
  assert.ok(JSON.stringify(seeded.content).includes('"pageRef"'))
  // A task row still refuses.
  refuses(ws, d20, doc => [...doc, { id: 't', type: 'task', props: { taskId: 'editor-task:t', role: 'reference' }, content: [ref('R', 'rt2')] }], /task row/)
})

test('Ratchet #84: a [[ link in a heading blocks A2\'s Undo too', () => {
  let { ws, d19, d20 } = setup()
  ws = ok(ws, { type: 'paste-links', pageId: d20, today: '2026-10-20', items: [{ url: 'https://h.example/', pageId: 'H', cardBlockId: 'cardH', lineType: 'paragraph' }] }, 'op-h')
  ws = save(ws, d20, doc => [...doc, { id: 'cardH', type: 'pageLink', props: { pageId: 'H' } }])
  ws = save(ws, d19, doc => [...doc, { id: 'hh', type: 'heading', props: { level: 2 }, content: [ref('H', 'rhh')] }])
  const r = run(ws, { type: 'undo-paste-links', pageId: d20, operationId: 'op-h', today: '2026-10-20' })
  assert.match(r.receipt.message, /linked from/)
  assert.ok(page(r.workspace, 'H'))
})
