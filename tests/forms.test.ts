// Forms, Only me (docs/design/forms.md, G7-1 to G7-8): a layout of a view, settings kept on it, and an answer that adds one row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand } from '../src/domain/workspace.ts'
import { writeSteps } from '../src/domain/buttons.ts'
import type { FormSettings } from '../src/domain/forms.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
function setup() {
  const h = harness()
  const C = (change: unknown) => h.run({ type: 'change-database', pageId: 'runs', change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'km', name: 'Distance', type: 'number' } })
  C({ kind: 'addProperty', property: { id: 'feel', name: 'Felt', type: 'select', options: [{ id: 'good', name: 'Good', color: 'gray' }, { id: 'hard', name: 'Hard', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'a', name: 'Hills', color: 'gray' }, { id: 'b', name: 'Rain', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
  C({ kind: 'addProperty', property: { id: 'ok', name: 'Stretched', type: 'checkbox' } })
  C({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  C({ kind: 'addProperty', property: { id: 'pace', name: 'Pace', type: 'formula', formula: 'prop("km") * 2' } })
  C({ kind: 'addView', view: { id: 'f', name: 'Log a run', layout: 'form', columns: [], sort: [], filter: [] } })
  return { h, C }
}
const db = (h: ReturnType<typeof harness>) => h.page('runs').database!
const form = (h: ReturnType<typeof harness>) => db(h).views.find(v => v.id === 'f')!.form!
const rows = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const answer = (h: ReturnType<typeof harness>, pageId: string, title: string, values: Record<string, unknown>, operationId?: string) =>
  h.run({ type: 'answer-form', databaseId: 'runs', viewId: 'f', pageId, title, values, at } as never, operationId)

test('a new form asks a question for each property it can, Name first, and the first form makes Responses', () => {
  const { h, C } = setup()
  assert.deepEqual(form(h).questions.map(q => q.wording), ['Name', 'Distance', 'Felt', 'Tags', 'When', 'Stretched', 'Note'], 'not the formula')
  assert.deepEqual(db(h).views.map(v => [v.name, v.layout]), [['Table', 'table'], ['Log a run', 'form'], ['Responses', 'table']])
  C({ kind: 'addView', view: { id: 'f2', name: 'Another', layout: 'form', columns: [], sort: [], filter: [] } })
  assert.equal(db(h).views.filter(v => v.name === 'Responses').length, 1)
  // A view turned into a form takes its questions then; turned back, it keeps them.
  C({ kind: 'updateView', viewId: db(h).views[0]!.id, layout: 'form' })
  assert.equal(db(h).views[0]!.form?.questions.length, 7)
  C({ kind: 'updateView', viewId: db(h).views[0]!.id, layout: 'table' })
  assert.equal(db(h).views[0]!.form?.questions.length, 7)
})

test('wording never renames a property; a property made from the form is asked in the words it was named with', () => {
  const { h, C } = setup()
  const next: FormSettings = { ...form(h), questions: form(h).questions.map(q => (q.propertyId === 'km' ? { ...q, wording: 'How far did you go?', required: true } : q)) }
  C({ kind: 'updateView', viewId: 'f', form: next })
  assert.equal(db(h).properties.find(p => p.id === 'km')!.name, 'Distance')
  assert.equal(form(h).questions.find(q => q.propertyId === 'km')!.wording, 'How far did you go?')
  C({ kind: 'addProperty', property: { id: 'mood', name: 'Mood today', type: 'text' }, viewId: 'f' })
  assert.deepEqual(form(h).questions.at(-1), { propertyId: 'mood', wording: 'Mood today' })
  assert.throws(() => C({ kind: 'updateView', viewId: 'f', form: { questions: [{ propertyId: 'pace', wording: 'Pace' }] } }), /Pace can't be a question/)
  assert.throws(() => C({ kind: 'updateView', viewId: 'f', form: { questions: [{ propertyId: 'km', wording: 'a' }, { propertyId: 'km', wording: 'b' }] } }), /Invalid form/)
})

test('one answer makes one row with each type\'s value, counts it, and one Undo takes back both', () => {
  const { h } = setup()
  const r = answer(h, 'ans-1', 'Morning run', { km: 5.2, feel: 'good', tags: ['a', 'b'], when: { start: '2026-11-05' }, ok: true, note: '中文 note' })
  const row = rows(h).find(p => p.id === 'ans-1')!
  assert.equal(row.title, 'Morning run')
  assert.deepEqual(row.values, { ...row.values, km: 5.2, feel: 'good', tags: ['a', 'b'], when: { start: '2026-11-05' }, ok: true, note: '中文 note' })
  assert.equal(form(h).responses, 1)
  assert.equal(r.receipt.message, 'Sent')
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.ok(!rows(h).some(p => p.id === 'ans-1'))
  assert.equal(form(h).responses, undefined)
})

test('a retry of the same send makes no second row', () => {
  const { h } = setup()
  const action = { type: 'answer-form', databaseId: 'runs', viewId: 'f', pageId: 'ans-1', title: 'Once', values: { km: 1 }, at } as never
  const revision = h.ws.revision
  h.ws = applyCommand(h.ws, { operationId: 'key-1', expectedRevision: revision, action }).workspace
  const again = applyCommand(h.ws, { operationId: 'key-1', expectedRevision: revision, action })
  assert.equal(rows(h).filter(p => p.id === 'ans-1').length, 1)
  assert.equal(again.workspace.revision, h.ws.revision, 'the receipt answered it')
})

test('required, removed and over-the-limit answers; closed, deleted, Trash and unknown all read the same', () => {
  const { h, C } = setup()
  C({ kind: 'updateView', viewId: 'f', form: { ...form(h), questions: form(h).questions.filter(q => q.propertyId !== 'note').map(q => (q.propertyId === 'km' ? { ...q, required: true } : q.propertyId === 'tags' ? { ...q, max: 1 } : q)) } })
  assert.throws(() => answer(h, 'a1', 'No distance', {}), /Needs an answer: Distance/)
  assert.throws(() => answer(h, 'a2', 'Too many', { km: 1, tags: ['a', 'b'] }), /Tags: 1 at most/)
  answer(h, 'a3', 'With a removed one', { km: 2, note: 'asked before it went' })
  assert.equal(rows(h).find(p => p.id === 'a3')!.values?.note, undefined, 'a question removed while open: the others are sent')
  C({ kind: 'updateView', viewId: 'f', form: { ...form(h), closed: true } })
  assert.throws(() => answer(h, 'a4', 'Closed', { km: 1 }), /^Error: This form is closed$/)
  assert.throws(() => h.run({ type: 'answer-form', databaseId: 'runs', viewId: 'nope', pageId: 'a5', title: '', values: {}, at } as never), /^Error: This form is closed$/)
  assert.throws(() => h.run({ type: 'answer-form', databaseId: 'nowhere', viewId: 'f', pageId: 'a6', title: '', values: {}, at } as never), /^Error: This form is closed$/)
  C({ kind: 'updateView', viewId: 'f', form: { ...form(h), closed: undefined } as never })
  h.run({ type: 'delete-page', pageId: 'runs', at } as never)
  assert.throws(() => answer(h, 'a7', 'In Trash', { km: 1 }), /^Error: This form is closed$/)
})

test('an answer sets off a Row added rule', () => {
  const { h, C } = setup()
  C({ kind: 'addAutomation', automation: { id: 'r', name: 'Mark it', active: true, triggers: [{ kind: 'row-added' }], steps: writeSteps([{ id: 'e', kind: 'edit-property', set: [{ id: 'ok', name: 'Stretched', value: { kind: 'fixed', raw: true } }] }]) } })
  answer(h, 'a1', 'Run', { km: 3 })
  assert.equal(rows(h).find(p => p.id === 'a1')!.values?.ok, true)
})
