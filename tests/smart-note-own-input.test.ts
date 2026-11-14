// A smart note never reads itself (Jazz 01ec668c, Lead c1eac402): placing a new note on Whole workspace, with `/`, leaves
// its input as the preview read it, so no "Notes changed" shows after Save, after a reload, or after its own Refresh.
// Editing another line of the host page still shows it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectInput, smartNoteBlockType, type SmartRange } from '../src/domain/smart-note.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
import { bullet, harness, text } from './v2-helpers.ts'

const today = '2026-11-14'
const workspace: SmartRange = { where: { kind: 'workspace' }, days: 0 } as SmartRange
const note = (id = 'sn'): EditorNode => ({ id, type: smartNoteBlockType, props: { noteId: 'n1' }, content: undefined, children: [] }) as unknown as EditorNode
const emptyParagraph = (id: string): EditorNode => ({ id, type: 'paragraph', props: {}, content: [], children: [] }) as unknown as EditorNode
const keyNow = (h: ReturnType<typeof harness>) => collectInput(h.ws, workspace, today).key

function withDay() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Trip', body: 'pack the bags', pageId: 'trip' } as never)
  const day = h.day(today)
  return { h, day }
}

test("a note placed after a line of today's untouched day: the day isn't read because of it", () => {
  const { h, day } = withDay()
  const previewed = keyNow(h)
  h.save(day.id, d => [...d, note()])
  assert.equal(keyNow(h), previewed, 'after Save: the same input, so no "Notes changed"')
  assert.equal(collectInput(h.ws, workspace, today).pages.some(p => p.pageId === day.id), false)
})

test("a note taking the empty line its `/` was typed in, on today's day: the same input before and after", () => {
  const { h, day } = withDay()
  // He adds a line and types `/` there: the preview reads the day with that empty line in it.
  h.save(day.id, d => [...d, emptyParagraph('slash')])
  const previewed = keyNow(h)
  // Save puts the note in that line's place.
  h.save(day.id, d => d.map(n => (n.id === 'slash' ? note() : n)))
  assert.equal(keyNow(h), previewed)
})

test('on a page he writes in, the note in place of its empty `/` line changes nothing read', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Plans', body: 'see the doctor', pageId: 'plans' } as never)
  h.save('plans', d => [...d, emptyParagraph('slash')])
  const previewed = keyNow(h)
  h.save('plans', d => d.map(n => (n.id === 'slash' ? note() : n)))
  assert.equal(keyNow(h), previewed)
})

test('editing another line of the host page still shows "Notes changed"; a Refresh then takes the new input', () => {
  const { h, day } = withDay()
  h.save(day.id, d => [...d, note()])
  const stored = keyNow(h)
  h.save(day.id, d => [...d, bullet('l-new', text('call the bank'))])
  const now = keyNow(h)
  assert.notEqual(now, stored, 'his own writing on the day is input')
  assert.equal(keyNow(h), now, 'a Refresh stores this key, and reading again gives it back')
})
