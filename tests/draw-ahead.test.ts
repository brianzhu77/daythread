import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aheadWord, drawRule, drawsAhead, takenBackText } from '../src/components/draw-ahead.ts'
import type { Action } from '../src/domain/types.ts'

// Release 2 (#374): what is drawn before the server answers. The Records make every action type placed and every
// drawn type named at compile time; these pin the payload rules and the wording.

const ahead = Object.entries(drawRule).filter(([, r]) => r === 'ahead').map(([t]) => t)

test('every drawn-ahead type has its own noun, never the plain fallback (Jazz 5869fde3)', () => {
  for (const type of ahead) {
    const action = (type === 'change-database' ? { type, change: { kind: 'updateView' } } : { type }) as unknown as Action
    const text = takenBackText({ action, held: { reason: 'changed-since' } })
    assert.match(text, / · changed elsewhere$/, type)
    assert.doesNotMatch(text, /^Not saved/, type)
  }
  assert.deepEqual(Object.keys(aheadWord).sort(), [...ahead].sort())
})

test('the Lead and Ratchet rulings: what waits (5b22d29e, 242d438f, 6458ed11)', () => {
  for (const type of ['create-document', 'create-template', 'create-database', 'add-row', 'add-rows', 'add-task', 'add-comment', 'edit-comment', 'make-link-pages', 'import-csv', 'move-row'])
    assert.equal(drawRule[type as Action['type']], 'wait', type)
  for (const type of ['rename-page', 'rename-task']) assert.equal(drawRule[type as Action['type']], 'ahead', type)
  // A tick, a cell's value and the draft's decisions keep their own marks; Undo is never drawn.
  for (const type of ['task-status', 'set-values', 'set-values-many', 'apply-draft', 'skip-draft', 'undo', 'save-editor'])
    assert.equal(drawRule[type as Action['type']], 'own', type)
})

test('a paste that makes rows waits; one that only edits cells is drawn', () => {
  const paste = (rows: number) => ({ type: 'paste-cells', databaseId: 'db', items: [], rows: Array.from({ length: rows }, (_, i) => ({ pageId: `r${i}`, title: '' })), at: '' }) as Action
  assert.equal(drawsAhead(paste(0)), true)
  assert.equal(drawsAhead(paste(1)), false)
})

test('a database change that adds a column, view or automation waits; an edit of one is drawn; an unknown kind waits', () => {
  const change = (kind: string) => ({ type: 'change-database', pageId: 'db', change: { kind } }) as unknown as Action
  for (const kind of ['addProperty', 'duplicateProperty', 'addView', 'addAutomation', 'setDependencies', 'setSubItems', 'setMirror', 'somethingNew'])
    assert.equal(drawsAhead(change(kind)), false, kind)
  for (const kind of ['updateProperty', 'removeProperty', 'moveProperty', 'updateView', 'removeView', 'moveView', 'updateWidget', 'setDashboardFilter'])
    assert.equal(drawsAhead(change(kind)), true, kind)
})

test('a database change is named by what it touches', () => {
  const text = (kind: string) => takenBackText({ action: { type: 'change-database', pageId: 'db', change: { kind } } as unknown as Action, held: { reason: 'conflict' } })
  assert.equal(text('updateProperty'), 'Property not saved · changed elsewhere')
  assert.equal(text('moveView'), 'View not moved · changed elsewhere')
  assert.equal(text('removeProperty'), 'Property not deleted · changed elsewhere')
  assert.equal(text('updateWidget'), 'Widget not saved · changed elsewhere')
  assert.equal(text('setDashboardFilter'), 'Filter not saved · changed elsewhere')
  assert.equal(text('setAutomationActive'), 'Automation not saved · changed elsewhere')
})

test('deletes and moves say what didn\'t happen (Jazz f92b65df)', () => {
  const text = (type: string) => takenBackText({ action: { type } as Action, held: { reason: 'conflict' } })
  assert.equal(text('delete-page'), 'Page not deleted · changed elsewhere')
  assert.equal(text('delete-pages'), 'Pages not deleted · changed elsewhere')
  assert.equal(text('move-page'), 'Not moved · changed elsewhere')
  assert.equal(text('delete-template'), 'Template not deleted · changed elsewhere')
  assert.equal(text('delete-comment'), 'Comment not deleted · changed elsewhere')
})
