// A smart note is a workspace-level record; pages hold only a `smartNote` block that names it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
import { placedSmartNotes, smartPlaces, type SmartNote, type SmartResult } from '../src/domain/smart-note.ts'
import { harness } from './v2-helpers.ts'

const result = (over: Partial<SmartResult> = {}): SmartResult => ({ blocks: [{ kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: 'doc', blockId: 'l1' }] }], at: '2026-11-12T09:00:00.000Z', inputKey: 'k1', pagesRead: 1, pagesLeftOut: 0, from: '2026-11-12', to: '2026-11-12', ...over })
const note = (over: Partial<SmartNote> = {}): SmartNote => ({ id: 'n1', name: 'Checkout', prompt: 'What do my notes say about checkout?', range: { where: { kind: 'workspace' }, days: 0 }, refresh: 'manual', result: result(), ...over })
const block = (id: string, noteId: string): EditorNode => ({ id, type: 'smartNote', props: { noteId }, children: [] })
const withDoc = () => { const h = harness(); h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' }); return h }

test('save-smart-note stores the note; saving the same id replaces it', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  const second = h.run({ type: 'save-smart-note', note: note({ name: 'Renamed' }) })
  assert.equal(h.ws.smartNotes!.length, 1)
  assert.equal(h.ws.smartNotes![0].name, 'Renamed')
  assert.equal(second.receipt.message, 'Smart note saved')
})

test('a blank name is taken from the prompt, cut at 60 characters', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note({ name: '   ' }) })
  assert.equal(h.ws.smartNotes![0].name, 'What do my notes say about checkout?')
  h.run({ type: 'save-smart-note', note: note({ id: 'n2', name: '', prompt: 'x'.repeat(100) }) })
  assert.equal(h.ws.smartNotes![1].name, 'x'.repeat(60))
})

test('a source whose page does not exist is dropped, not refused', () => {
  const h = withDoc()
  const source = { kind: 'bullet' as const, text: 'Two sources', sources: [{ pageId: 'gone', blockId: 'x' }, { pageId: 'doc', blockId: 'l1' }] }
  h.run({ type: 'save-smart-note', note: note({ result: result({ blocks: [source] }) }) })
  assert.deepEqual(h.ws.smartNotes![0].result.blocks[0].sources, [{ pageId: 'doc', blockId: 'l1' }])
})

test('refused: empty prompt; pages range with no page; a 101st note', () => {
  const h = withDoc()
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ prompt: '  ' }) }), /prompt/i)
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ range: { where: { kind: 'pages', pageIds: [] }, days: 0 } }) }), /page/i)
  for (let i = 0; i < 100; i++) h.run({ type: 'save-smart-note', note: note({ id: `n${i}` }) })
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ id: 'extra' }) }), /limit/i)
  h.run({ type: 'save-smart-note', note: note({ id: 'n0', name: 'Still saves' }) })
  assert.equal(h.ws.smartNotes![0].name, 'Still saves')
})

test('set-smart-note-result replaces the result; an unknown note is refused', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  const done = h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'k2' }) })
  assert.equal(done.receipt.message, 'Smart note updated')
  assert.equal(h.ws.smartNotes![0].result.inputKey, 'k2')
  assert.throws(() => h.run({ type: 'set-smart-note-result', noteId: 'nope', result: result() }), /Smart note not found/)
})

test('Undo of a save takes the note away; Undo of a result brings the previous result back', () => {
  const h = withDoc()
  const saved = h.run({ type: 'save-smart-note', note: note() })
  h.run({ type: 'undo', targetOperationId: saved.receipt.operationId })
  assert.equal(h.ws.smartNotes, undefined)
  h.run({ type: 'save-smart-note', note: note() })
  const updated = h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'k2' }) })
  h.run({ type: 'undo', targetOperationId: updated.receipt.operationId })
  assert.equal(h.ws.smartNotes![0].result.inputKey, 'k1')
})

test('places: a block on a live page counts, one on a page in Trash does not; an unplaced note is not in placedSmartNotes', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  h.run({ type: 'save-smart-note', note: note({ id: 'n2', name: 'Unplaced' }) })
  h.save('doc', d => [...d, block('b1', 'n1')])
  assert.deepEqual(smartPlaces(h.ws, 'n1').map(p => [p.page.id, p.blockId]), [['doc', 'b1']])
  assert.deepEqual(placedSmartNotes(h.ws).map(p => [p.note.id, p.places]), [['n1', 1]])
  h.run({ type: 'delete-page', pageId: 'doc', at: '2026-11-12T10:00:00.000Z' })
  assert.deepEqual(smartPlaces(h.ws, 'n1'), [])
  assert.deepEqual(placedSmartNotes(h.ws), [])
})

test('the command schema accepts both actions and refuses a result with 61 blocks', () => {
  const command = (action: unknown) => commandSchema.safeParse({ operationId: 'op', expectedRevision: 0, action })
  assert.ok(command({ type: 'save-smart-note', note: note() }).success)
  assert.ok(command({ type: 'set-smart-note-result', noteId: 'n1', result: result() }).success)
  const many = result({ blocks: Array.from({ length: 61 }, () => ({ kind: 'paragraph' as const, text: 'x', sources: [] })) })
  assert.ok(!command({ type: 'set-smart-note-result', noteId: 'n1', result: many }).success)
  assert.ok(!command({ type: 'save-smart-note', note: note({ result: many }) }).success)
})
