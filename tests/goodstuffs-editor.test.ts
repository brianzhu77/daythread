import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// Regression: since the editor replaced DayPage, a link written in Good Stuffs must still become saved material (01 §6.1, P14).
const run = (ws: Workspace, action: Action) => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace
const linkLine = (id: string, url: string): EditorNode => ({ id, type: 'paragraph', content: [{ type: 'link', href: url, content: [{ type: 'text', text: url, styles: {} }] }] })
const textLine = (id: string, value: string): EditorNode => ({ id, type: 'paragraph', content: value })
function day(date = '2026-10-18') { return run(createEmptyWorkspace(), { type: 'ensure-day', date }) }
function dayPage(ws: Workspace, date = '2026-10-18') { return ws.pages.find(p => p.date === date)! }
/** Saves the page with `lines` inserted right under the heading of section `kind`. */
function saveWith(ws: Workspace, kind: string, lines: EditorNode[], date = '2026-10-18') {
  const p = dayPage(ws, date), doc = editorSeed(p, ws)
  const at = doc.findIndex(n => n.id === p.sections.find(s => s.kind === kind)!.id)
  doc.splice(at + 1, 0, ...lines)
  return run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
}
/** Re-saves the page with the text of one existing line replaced. */
function editLine(ws: Workspace, id: string, line: EditorNode, date = '2026-10-18') {
  const p = dayPage(ws, date), doc = editorSeed(p, ws).map(n => n.id === id ? line : n)
  return run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
}
const block = (ws: Workspace, id: string, date = '2026-10-18') => dayPage(ws, date).sections.flatMap(s => s.blocks).find(b => b.id === id)!

test('a URL alone on a Good Stuffs line becomes one saved material with this line as its source', () => {
  const ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  assert.equal(ws.materials.length, 1)
  const m = ws.materials[0]!
  assert.equal(m.url, 'https://example.com/a'); assert.equal(m.reviewState, 'pending'); assert.equal(m.savedOn, '2026-10-18')
  assert.deepEqual(m.sources, [{ pageId: dayPage(ws).id, blockId: 'g1', note: '' }])
  assert.equal(block(ws, 'g1').kind, 'material'); assert.equal(block(ws, 'g1').materialId, m.id)
})

test('a URL typed as plain text (not a link mark) counts too', () => {
  const ws = saveWith(day(), 'good-stuffs', [textLine('g1', '  https://example.com/plain ')])
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.url, 'https://example.com/plain')
})

test('no material: URL inside a sentence, URL outside Good Stuffs, a task row, or not http(s)', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('s1', 'read https://example.com/a later'), textLine('s2', 'ftp://example.com/x')])
  ws = saveWith(ws, 'notes', [linkLine('n1', 'https://example.com/b')])
  const p = dayPage(ws), doc = editorSeed(p, ws), at = doc.findIndex(n => n.id === p.sections.find(s => s.kind === 'good-stuffs')!.id)
  doc.splice(at + 1, 0, { id: 't1', type: 'task', props: { taskId: 'editor-task:t1', role: 'reference', planDate: '' }, content: 'https://example.com/c' })
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  assert.equal(ws.materials.length, 0)
  assert.equal(block(ws, 't1').kind, 'task')
})

test('the same URL on two days is one material with two sources; repeated saves add nothing', () => {
  let ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  ws = editLine(ws, 'g1', linkLine('g1', 'https://example.com/a'))
  ws = run(ws, { type: 'ensure-day', date: '2026-10-19' })
  ws = saveWith(ws, 'good-stuffs', [linkLine('g2', 'https://example.com/a')], '2026-10-19')
  assert.equal(ws.materials.length, 1)
  assert.deepEqual(ws.materials[0]!.sources.map(s => s.blockId), ['g1', 'g2'])
})

test('a material saved before keeps its follow-up state; a Done one goes back to sort (G05)', () => {
  let ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  ws = run(ws, { type: 'review-material', materialId: ws.materials[0]!.id, decision: 'done', date: '2026-10-18' })
  ws = run(ws, { type: 'ensure-day', date: '2026-10-19' })
  ws = saveWith(ws, 'good-stuffs', [linkLine('g2', 'https://example.com/a')], '2026-10-19')
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.reviewState, 'pending')
})

test('typing the URL across several debounced saves leaves exactly one material, for the final URL', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g1', 'https://exa')])
  for (const partial of ['https://example.co', 'https://example.com/a']) ws = editLine(ws, 'g1', textLine('g1', partial))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.url, 'https://example.com/a')
  assert.deepEqual(ws.materials[0]!.sources.map(s => s.blockId), ['g1'])
})

test('turning the line into prose keeps the material; the words become that save\'s note', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g1', 'https://example.com/a')])
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/a — keep this'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.url, 'https://example.com/a')
  assert.deepEqual(ws.materials[0]!.sources, [{ pageId: dayPage(ws).id, blockId: 'g1', note: 'keep this' }])
  ws = editLine(ws, 'g1', textLine('g1', 'never mind'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.sources[0]!.note, 'never mind')
})

test('Ratchet #66: Don\'t resurface, then a note on the line, keeps the material and its choice', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g1', 'https://example.com/a')])
  ws = run(ws, { type: 'material-resurface', materialId: ws.materials[0]!.id, enabled: false })
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/a — keep this'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.resurface, false)
})

test('an acted-on material is never re-keyed, even if the line becomes another bare URL', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g1', 'https://example.com/a')])
  ws = run(ws, { type: 'material-resurface', materialId: ws.materials[0]!.id, enabled: false })
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/b'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.url, 'https://example.com/a')
})

test('a half-typed URL that completes into an already saved URL becomes another save of it', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g0', 'https://example.com/a')])
  ws = saveWith(ws, 'good-stuffs', [textLine('g1', 'https://exa')])
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/a'))
  assert.equal(ws.materials.length, 1)
  assert.deepEqual(ws.materials[0]!.sources.map(s => s.blockId).sort(), ['g0', 'g1'])
  assert.equal(block(ws, 'g1').materialId, ws.materials[0]!.id)
})

test('once a material has a decision or a second source, editing the line no longer changes it', () => {
  let ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  ws = run(ws, { type: 'review-material', materialId: ws.materials[0]!.id, decision: 'watching', date: '2026-10-18' })
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/a — my note'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.url, 'https://example.com/a'); assert.equal(block(ws, 'g1').materialId, ws.materials[0]!.id)
})

test('deleting the line keeps the material (P05)', () => {
  let ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  const p = dayPage(ws), doc = editorSeed(p, ws).filter(n => n.id !== 'g1')
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  assert.equal(ws.materials.length, 1)
})

test('a renamed Good Stuffs heading still saves links (P17)', () => {
  let ws = day()
  const p = dayPage(ws), gs = p.sections.find(s => s.kind === 'good-stuffs')!
  const doc = editorSeed(p, ws).map(n => n.id === gs.id ? { ...n, content: 'Reading' } : n)
  ws = run(ws, { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  ws = saveWith(ws, 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  assert.equal(ws.materials.length, 1)
})

test('relink-material-lines saves links written before the fix and writes nothing the second time', () => {
  let ws = saveWith(day(), 'good-stuffs', [linkLine('g1', 'https://example.com/a')])
  // State as the pre-fix editor left it: the URL line stored as a plain paragraph, no material.
  ws = structuredClone(ws); ws.materials = []
  const b = dayPage(ws).sections.flatMap(s => s.blocks).find(b => b.id === 'g1')!
  b.kind = 'paragraph'; delete b.materialId
  ws = run(ws, { type: 'relink-material-lines' })
  assert.equal(ws.materials.length, 1); assert.equal(block(ws, 'g1').kind, 'material')
  const revision = ws.revision
  assert.throws(() => run(ws, { type: 'relink-material-lines' }), /nothing written/)
  assert.equal(ws.revision, revision)
})

// Brian's own format (78871f09): `- [xx](url)`, a titled link in a bullet.
const titled = (id: string, title: string, url: string, type = 'bulletListItem', before = '', after = ''): EditorNode => ({ id, type, content: [
  ...(before ? [{ type: 'text', text: before, styles: {} }] : []),
  { type: 'link', href: url, content: [{ type: 'text', text: title, styles: {} }] },
  ...(after ? [{ type: 'text', text: after, styles: {} }] : []),
] })

test('a titled link alone on a line (bullet, spaces around it) saves the href with the link text as title', () => {
  const ws = saveWith(day(), 'good-stuffs', [titled('g1', 'xx', 'https://example.com/read', 'bulletListItem', ' ', '  ')])
  assert.equal(ws.materials.length, 1)
  assert.equal(ws.materials[0]!.url, 'https://example.com/read'); assert.equal(ws.materials[0]!.title, 'xx')
  assert.equal(block(ws, 'g1').kind, 'material')
})

test('a titled link inside a sentence stays a plain link', () => {
  const ws = saveWith(day(), 'good-stuffs', [titled('g1', 'xx', 'https://example.com/read', 'paragraph', 'great read: ')])
  assert.equal(ws.materials.length, 0)
})

test('editing the link text of an untouched item updates its title; the URL and identity stay', () => {
  let ws = saveWith(day(), 'good-stuffs', [titled('g1', 'xx', 'https://example.com/read')])
  ws = editLine(ws, 'g1', titled('g1', 'Calm tech essay', 'https://example.com/read'))
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.id, 'material:g1'); assert.equal(ws.materials[0]!.title, 'Calm tech essay')
})

test('relink-material-lines also finds titled links in the saved editor document', () => {
  let ws = saveWith(day(), 'good-stuffs', [titled('g1', 'xx', 'https://example.com/read')])
  // Simulate the pre-fix state: same editor document, but the line projected as a plain paragraph.
  ws = structuredClone(ws); ws.materials = []
  const b = dayPage(ws).sections.flatMap(s => s.blocks).find(b => b.id === 'g1')!
  b.kind = 'paragraph'; delete b.materialId
  ws = run(ws, { type: 'relink-material-lines' })
  assert.equal(ws.materials.length, 1); assert.equal(ws.materials[0]!.title, 'xx')
})

test('Ratchet #66: an item whose title was changed elsewhere is not re-keyed or retitled by the line', () => {
  let ws = saveWith(day(), 'good-stuffs', [textLine('g1', 'https://example.com/a')])
  ws = structuredClone(ws); ws.materials[0]!.title = 'User title'
  ws = editLine(ws, 'g1', textLine('g1', 'https://example.com/b'))
  assert.equal(ws.materials.length, 1)
  assert.equal(ws.materials[0]!.url, 'https://example.com/a'); assert.equal(ws.materials[0]!.title, 'User title')
})
