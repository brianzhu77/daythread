// A smart note is a workspace-level record; pages hold only a `smartNote` block that names it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { inlineText, isEmptyLine, type EditorNode } from '../src/domain/editor-document.ts'
import { hasContent, writtenDays } from '../src/domain/page-tree.ts'
import { exportJson, fileNames, pageMarkdown } from '../src/domain/export.ts'
import { livePlaces, placedSmartNotes, smartNoteLines, smartNoteName, smartNoteText, smartPlaces, smartSpecKey, sourceNumbers, type SmartBlock, type SmartNote, type SmartResult } from '../src/domain/smart-note.ts'
import { bullet, harness, text, todo } from './v2-helpers.ts'

const result = (over: Partial<SmartResult> = {}): SmartResult => ({ blocks: [{ kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: 'doc', blockId: 'l1' }] }], at: '2026-11-12T09:00:00.000Z', inputKey: 'k1', pagesRead: 1, pagesLeftOut: 0, from: '2026-11-12', to: '2026-11-12', ...over })
const note = (over: Partial<SmartNote> = {}): SmartNote => ({ id: 'n1', name: 'Checkout', prompt: 'What do my notes say about checkout?', range: { where: { kind: 'workspace' }, days: 0 }, refresh: 'manual', result: result(), ...over })
/** What `note()`'s result answers. */
const spec = smartSpecKey(note().prompt, note().range)
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

test("a blank name is taken from the prompt's first sentence", () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note({ name: '   ' }) })
  assert.equal(h.ws.smartNotes![0].name, 'What do my notes say about checkout?')
  h.run({ type: 'save-smart-note', note: note({ id: 'n2', name: '', prompt: 'Where does checkout stand? Decisions first, then open questions.' }) })
  assert.equal(h.ws.smartNotes![1].name, 'Where does checkout stand?')
})

test('a name from the prompt: first sentence or line, else a cut at a word, or at a character in Chinese', () => {
  // English: the first sentence, its full stop dropped; a long one is cut at a word.
  assert.equal(smartNoteName('Summarize my week. Keep it short.'), 'Summarize my week')
  assert.equal(smartNoteName('Weekly review\nWhat moved, what stalled'), 'Weekly review')
  assert.equal(smartNoteName('List every decision we made about the checkout redesign and who made each of them'), 'List every decision we made about the checkout redesign…')
  assert.equal(smartNoteName('x'.repeat(100)), 'x'.repeat(59) + '…')
  // Chinese: sentence marks without spaces; a long sentence is cut at a character.
  assert.equal(smartNoteName('这周结账改版进展如何？先列决定。'), '这周结账改版进展如何？')
  const zh = '总结这个月所有关于结账改版的决定以及每一个决定是谁做出的'.repeat(3)
  assert.equal(smartNoteName(zh), Array.from(zh).slice(0, 59).join('') + '…')
  // Mixed: the cut falls on Chinese, so at a character; a sentence ending in English punctuation still ends there.
  const mixed = 'Checkout 进展 ' + zh
  assert.equal(smartNoteName(mixed), Array.from(mixed).slice(0, 59).join('') + '…')
  assert.equal(smartNoteName('Checkout 进展? Then the rest'), 'Checkout 进展?')
  // A prompt whose first sentence is only a full stop still gets a name: its first line (Ratchet).
  assert.equal(smartNoteName('.'), '.')
  assert.equal(smartNoteName('。 summarize'), '。 summarize')
  assert.equal(smartNoteName('. ' + 'x'.repeat(100)), '. ' + 'x'.repeat(57) + '…')
  for (const p of ['List every decision we made about the checkout redesign and who made each of them', zh, mixed]) assert.ok(Array.from(smartNoteName(p)).length <= 60)
})

test('a source whose page does not exist is dropped, not refused', () => {
  const h = withDoc()
  const source = { kind: 'bullet' as const, text: 'Two sources', sources: [{ pageId: 'gone', blockId: 'x' }, { pageId: 'doc', blockId: 'l1' }] }
  h.run({ type: 'save-smart-note', note: note({ result: result({ blocks: [source] }) }) })
  assert.deepEqual(h.ws.smartNotes![0].result.blocks[0].sources, [{ pageId: 'doc', blockId: 'l1' }])
})

test('refused: a result whose time is not a time, on save and on refresh', () => {
  const h = withDoc()
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ result: result({ at: 'not a time' }) }) }), /Invalid time/)
  h.run({ type: 'save-smart-note', note: note() })
  assert.throws(() => h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ at: 'not a time' }), spec }), /Invalid time/)
  assert.equal(h.ws.smartNotes![0].result.at, '2026-11-12T09:00:00.000Z')
})

test('refused: empty prompt; pages range with no page', () => {
  const h = withDoc()
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ prompt: '  ' }) }), /prompt/i)
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ range: { where: { kind: 'pages', pageIds: [] }, days: 0 } }) }), /page/i)
})

test('limit: with 100 notes each on a page, a 101st is refused; a note with no block left makes room, the longest unrefreshed first', () => {
  const h = withDoc()
  const at = (i: number) => new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()
  for (let i = 0; i < 100; i++) h.run({ type: 'save-smart-note', note: note({ id: `n${i}`, result: result({ at: at(i) }) }) })
  h.save('doc', d => [...d, ...Array.from({ length: 100 }, (_, i) => block(`b${i}`, `n${i}`))])
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ id: 'extra' }) }), /Smart note limit reached/)
  h.run({ type: 'save-smart-note', note: note({ id: 'n0', name: 'Still saves' }) })
  assert.equal(h.ws.smartNotes![0].name, 'Still saves')
  // n7 and n3 lose their blocks; n3 was refreshed longer ago.
  h.save('doc', d => d.filter(n => n.id !== 'b7' && n.id !== 'b3'))
  h.run({ type: 'save-smart-note', note: note({ id: 'extra' }) })
  assert.equal(h.ws.smartNotes!.length, 100)
  assert.ok(!h.ws.smartNotes!.some(n => n.id === 'n3'))
  assert.ok(h.ws.smartNotes!.some(n => n.id === 'n7') && h.ws.smartNotes!.some(n => n.id === 'extra'))
})

test('limit: a note whose only block is on a page in Trash is kept, for Restore', () => {
  const h = withDoc()
  h.run({ type: 'create-document', title: 'Other', body: '', pageId: 'other' })
  for (let i = 0; i < 100; i++) h.run({ type: 'save-smart-note', note: note({ id: `n${i}` }) })
  h.save('doc', d => [...d, ...Array.from({ length: 99 }, (_, i) => block(`b${i}`, `n${i}`))])
  h.save('other', d => [...d, block('b99', 'n99')])
  h.run({ type: 'delete-page', pageId: 'other', at: '2026-11-12T10:00:00.000Z' })
  assert.throws(() => h.run({ type: 'save-smart-note', note: note({ id: 'extra' }) }), /Smart note limit reached/)
  assert.ok(h.ws.smartNotes!.some(n => n.id === 'n99'))
})

test('spec: the prompt trimmed and the range, a pages range in any order; a different prompt, place or window is another spec', () => {
  const pages = (pageIds: string[], days: 0 | 7 = 0) => ({ where: { kind: 'pages' as const, pageIds }, days })
  assert.equal(smartSpecKey('  What? ', pages(['a', 'b'])), smartSpecKey('What?', pages(['b', 'a', 'a'])))
  const others = [smartSpecKey('What else?', pages(['a', 'b'])), smartSpecKey('What?', pages(['a'])), smartSpecKey('What?', pages(['a', 'b'], 7)), smartSpecKey('What?', { where: { kind: 'tag', tag: 'a' }, days: 0 }), smartSpecKey('What?', { where: { kind: 'workspace' }, days: 0 }), smartSpecKey('What?', { where: { kind: 'days' }, days: 0 })]
  assert.equal(new Set([smartSpecKey('What?', pages(['a', 'b'])), ...others]).size, others.length + 1)
})

test('refused: a result made for the prompt or range as they were before an edit; the stored result stays', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  // Edited while the model ran: the note now holds the edit's own result.
  h.run({ type: 'save-smart-note', note: note({ prompt: 'What changed in checkout?', result: result({ inputKey: 'edited' }) }) })
  assert.throws(() => h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'late' }), spec }), /Smart note changed/)
  h.run({ type: 'save-smart-note', note: note({ range: { where: { kind: 'days' }, days: 7 }, result: result({ inputKey: 'edited' }) }) })
  assert.throws(() => h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'late' }), spec }), /Smart note changed/)
  assert.equal(h.ws.smartNotes![0].result.inputKey, 'edited')
  // A rename is no change of what the result answers.
  h.run({ type: 'save-smart-note', note: note({ name: 'Renamed' }) })
  h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'fresh' }), spec })
  assert.equal(h.ws.smartNotes![0].result.inputKey, 'fresh')
})

test('set-smart-note-result replaces the result; an unknown note is refused', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  const done = h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'k2' }), spec })
  assert.equal(done.receipt.message, 'Smart note updated')
  assert.equal(h.ws.smartNotes![0].result.inputKey, 'k2')
  assert.throws(() => h.run({ type: 'set-smart-note-result', noteId: 'nope', result: result(), spec }), /Smart note not found/)
})

test('Undo of a save takes the note away; Undo of a result brings the previous result back', () => {
  const h = withDoc()
  const saved = h.run({ type: 'save-smart-note', note: note() })
  h.run({ type: 'undo', targetOperationId: saved.receipt.operationId })
  assert.equal(h.ws.smartNotes, undefined)
  h.run({ type: 'save-smart-note', note: note() })
  const updated = h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ inputKey: 'k2' }), spec })
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
  assert.ok(command({ type: 'set-smart-note-result', noteId: 'n1', result: result(), spec }).success)
  const many = result({ blocks: Array.from({ length: 61 }, () => ({ kind: 'paragraph' as const, text: 'x', sources: [] })) })
  assert.ok(!command({ type: 'set-smart-note-result', noteId: 'n1', result: many, spec }).success)
  assert.ok(!command({ type: 'set-smart-note-result', noteId: 'n1', result: result() }).success, 'no spec')
  assert.ok(!command({ type: 'save-smart-note', note: note({ result: many }) }).success)
})

test('places: a block whose note is gone is no place of any note and throws nothing', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  h.save('doc', d => [...d, block('b1', 'gone')])
  assert.deepEqual(placedSmartNotes(h.ws), [])
})

const blocks = (...list: SmartBlock[]) => result({ blocks: list })
const ids = () => { let n = 0; return () => `new-${++n}` }
const refsOf = (n: EditorNode) => (n.content as { type: string; props?: Record<string, string> }[]).filter(c => c.type === 'pageRef').map(c => c.props!)

test('lines: heading, paragraph and bullet become heading(3), paragraph and bulletListItem with the same words', () => {
  const h = withDoc()
  const lines = smartNoteLines(h.ws, note({ result: blocks({ kind: 'heading', text: 'Decisions', sources: [] }, { kind: 'paragraph', text: 'Two calls this week.', sources: [] }, { kind: 'bullet', text: 'Guest checkout is out', sources: [] }) }), ids())
  assert.deepEqual(lines.map(n => [n.type, n.props?.level, inlineText(n.content).trim()]), [['heading', 3, 'Decisions'], ['paragraph', undefined, 'Two calls this week.'], ['bulletListItem', undefined, 'Guest checkout is out']])
  assert.deepEqual(lines.map(n => n.id), ['new-1', 'new-2', 'new-3'])
})

test('lines: a source becomes a pageRef with pageId and lineId; a source on a to-do row carries its taskId; a source whose line is gone is left out', () => {
  const h = withDoc()
  h.save('doc', d => [...d, bullet('l1', text('Guest checkout is out')), todo('t1', 'Ask about tax rounding', 'reference', '')])
  const taskId = h.task('Ask about tax rounding').id
  const sources = [{ pageId: 'doc', blockId: 'l1' }, { pageId: 'doc', blockId: 't1' }, { pageId: 'doc', blockId: 'gone' }, { pageId: 'nope', blockId: 'l1' }]
  const [line] = smartNoteLines(h.ws, note({ result: blocks({ kind: 'bullet', text: 'Checkout', sources }) }), ids())
  assert.deepEqual(refsOf(line!).map(p => [p.pageId, p.lineId, p.taskId]), [['doc', 'l1', ''], ['doc', 't1', taskId]])
  assert.ok(refsOf(line!).every(p => p.refId))
})

test('text: "## Decisions", "- Guest checkout is out", blank line between a list and a heading', () => {
  const t = smartNoteText(note({ result: blocks(
    { kind: 'heading', text: 'Decisions', sources: [] },
    { kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: 'doc', blockId: 'l1' }] },
    { kind: 'bullet', text: 'Address form moves to one step', sources: [] },
    { kind: 'heading', text: 'Open questions', sources: [] },
    { kind: 'paragraph', text: 'Who owns tax rounding?', sources: [] },
  ) }))
  assert.equal(t, '## Decisions\n\n- Guest checkout is out\n- Address form moves to one step\n\n## Open questions\n\nWho owns tax rounding?')
})

test('numbers: the same line cited twice has one number; numbers follow first appearance', () => {
  const a = { pageId: 'doc', blockId: 'a' }, b = { pageId: 'doc', blockId: 'b' }, c = { pageId: 'other', blockId: 'a' }
  const numbers = sourceNumbers(blocks({ kind: 'bullet', text: 'One', sources: [b, a] }, { kind: 'bullet', text: 'Two', sources: [a, c, b] }))
  assert.deepEqual([...numbers], [['doc|b', 1], ['doc|a', 2], ['other|a', 3]])
})

test('export: a page holding a smart note block exports the note\'s name, its text and "Updated 2026-11-12"', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  h.save('doc', d => [...d, block('b1', 'n1'), block('b2', 'gone')])
  const md = pageMarkdown(h.page('doc'), h.ws, fileNames(h.ws))
  assert.match(md, /\*\*Checkout\*\*\n- Guest checkout is out\n_Updated 2026-11-12_/)
  assert.equal(md.match(/Updated/g)?.length, 1)
})

test('export: workspace.json holds each smart note whole, and has no such key with none', () => {
  const h = withDoc()
  assert.ok(!('smartNotes' in exportJson(h.ws, new Date('2026-11-12T10:00:00Z'))))
  h.run({ type: 'save-smart-note', note: note() })
  assert.deepEqual(exportJson(h.ws, new Date('2026-11-12T10:00:00Z')).smartNotes, [note()])
})

test('live places: a source whose line is gone, or whose page is in Trash, has no place', () => {
  const h = withDoc()
  h.save('doc', d => [...d, bullet('l1', text('Guest checkout is out'))])
  const r = blocks({ kind: 'bullet', text: 'Checkout', sources: [{ pageId: 'doc', blockId: 'l1' }, { pageId: 'doc', blockId: 'gone' }] })
  assert.deepEqual([...livePlaces(h.ws, r).keys()], ['doc|l1'])
  h.run({ type: 'delete-page', pageId: 'doc', at: '2026-11-12T10:00:00.000Z' })
  assert.equal(livePlaces(h.ws, r).size, 0)
})

test('a page source (blockId ""): the schema and save-smart-note keep it, it is live while its page is, and Turn into text makes it a page link', () => {
  const h = withDoc()
  const pageSource = { pageId: 'doc', blockId: '' }
  const r = blocks({ kind: 'bullet', text: 'Doc is on the list', sources: [pageSource] })
  assert.ok(commandSchema.safeParse({ operationId: 'op', expectedRevision: 0, action: { type: 'save-smart-note', note: note({ result: r }) } }).success)
  h.run({ type: 'save-smart-note', note: note({ result: r }) })
  assert.deepEqual(h.ws.smartNotes![0].result.blocks[0].sources, [pageSource])
  assert.deepEqual([...livePlaces(h.ws, r).keys()], ['doc|'])
  const [line] = smartNoteLines(h.ws, note({ result: r }), ids())
  assert.deepEqual(refsOf(line!).map(p => [p.pageId, p.lineId, p.taskId]), [['doc', '', '']])
  h.run({ type: 'delete-page', pageId: 'doc', at: '2026-11-12T10:00:00.000Z' })
  assert.equal(livePlaces(h.ws, r).size, 0)
  assert.deepEqual(refsOf(smartNoteLines(h.ws, note({ result: r }), ids())[0]!), [])
})

test('a page holding only a smart note block has content, and the block is no empty line', () => {
  const h = withDoc()
  h.run({ type: 'save-smart-note', note: note() })
  assert.equal(isEmptyLine(block('b1', 'n1')), false)
  const day = h.day('2026-11-10')
  h.save(day.id, () => [block('b1', 'n1')])
  assert.equal(hasContent(h.page(day.id)), true)
  assert.ok(writtenDays(h.ws).has('2026-11-10'))
})
