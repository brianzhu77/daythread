// Tap feedback (docs/design/tap-feedback.md): the pure parts. Which stored changes make a draft band look decided (§2.6),
// and which way a press moves a control's own colour (§1.2). The browser checks are tests/evidence/tap-feedback/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftDecisions, type OutboxEntry } from '../src/components/outbox.ts'
import { fillLuminance, toneOf } from '../src/components/press.ts'
import type { Action } from '../src/domain/types.ts'

let seq = 0
const entry = (operationId: string, action: Action, state: OutboxEntry['state'] = 'pending'): OutboxEntry =>
  ({ seq: ++seq, owner: 'o', operationId, action, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: [], refs: [], label: '', createdAt: 0, state })

test('tap feedback: stored apply and skip decisions are decided, in order, with their items', () => {
  const got = draftDecisions([
    entry('a1', { type: 'apply-draft', pageId: 'p', itemIds: ['i1'] }),
    entry('t1', { type: 'task-status', taskId: 't', status: 'done' } as Action),
    entry('s1', { type: 'skip-draft', pageId: 'p', itemIds: ['i2', 'i4'] }),
  ])
  assert.deepEqual(got, [
    { operationId: 'a1', type: 'apply-draft', pageId: 'p', itemIds: ['i1'], undone: false },
    { operationId: 's1', type: 'skip-draft', pageId: 'p', itemIds: ['i2', 'i4'], undone: false },
  ])
})

test('tap feedback: an Undo or a reopen stored after a decision marks it undone; a held one isn’t decided', () => {
  const got = draftDecisions([
    entry('a1', { type: 'apply-draft', pageId: 'p', itemIds: ['i1'] }),
    entry('u1', { type: 'undo', targetOperationId: 'a1' }),
    entry('s1', { type: 'skip-draft', pageId: 'p', itemIds: ['i2'] }),
    entry('r1', { type: 'reopen-draft', pageId: 'p', itemIds: ['i2'], skippedBy: 's1', seen: {} }),
    entry('a2', { type: 'apply-draft', pageId: 'p', itemIds: ['i3'] }, 'held'),
  ])
  assert.deepEqual(got.map(d => [d.operationId, d.undone]), [['a1', true], ['s1', true]])
})

test('tap feedback: a press dims a light or coloured fill, lifts a dark one, and follows the theme with no fill', () => {
  assert.equal(toneOf('rgba(0, 0, 0, 0)'), 'theme')
  assert.equal(toneOf('rgba(0, 0, 0, 0.06)'), 'theme')
  assert.equal(toneOf('rgb(249, 249, 249)'), 'dim')
  assert.equal(toneOf('rgb(0, 144, 255)'), 'dim')
  assert.equal(toneOf('rgb(32, 32, 32)'), 'lift')
  assert.equal(fillLuminance('transparent'), null)
})
