import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aheadNoun, drawRule, drawsAhead, takenBackText } from '../src/components/draw-ahead.ts'
import type { Action } from '../src/domain/types.ts'

// Release 2 (#374): what is drawn before the server answers. The Records make every action type placed and every
// drawn type named at compile time; these pin the payload rules and the wording.

const ahead = Object.entries(drawRule).filter(([, r]) => r === 'ahead').map(([t]) => t)

test('every drawn-ahead type has its own noun, never the plain fallback (Jazz 5869fde3)', () => {
  for (const type of ahead) {
    const text = takenBackText({ action: { type } as Action, held: { reason: 'changed-since' } })
    assert.match(text, /^\S.* not saved · changed elsewhere$/, type)
    assert.doesNotMatch(text, /^Not saved/, type)
  }
  assert.deepEqual(Object.keys(aheadNoun).sort(), [...ahead].sort())
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
