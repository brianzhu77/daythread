import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, commandFingerprint, compactReceipts, createEmptyWorkspace, receiptWindow, tombstoneWindow } from '../src/domain/workspace.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// Basics #1 (Lead 34bbdf01, Ratchet #154): receipts small and bounded, the Undo copy without receipts, and an
// operation never applied twice.
const day = '2026-10-16'
function setup() {
  let ws = createEmptyWorkspace(), n = 0
  const run = (action: Action, operationId = `op-${++n}`, expectedRevision = ws.revision) => {
    const r = applyCommand(ws, { operationId, expectedRevision, action })
    ws = r.workspace
    return r
  }
  run({ type: 'ensure-day', date: day })
  const page = () => ws.pages.find(p => p.date === day)!
  const addTask = (title: string, operationId?: string) => run({ type: 'add-task', pageId: page().id, sectionId: page().sections.find(s => s.kind === 'other')!.id, title }, operationId)
  return { run, addTask, get ws() { return ws }, set ws(v: Workspace) { ws = v } }
}

test('a receipt stores a short hash of the action, and a retry with the same action replays it', () => {
  const s = setup(), before = s.ws.revision
  const first = s.addTask('Short fingerprint', 'same-op')
  assert.match(first.receipt.fingerprint!, /^c128:[0-9a-f]{32}$/)
  const again = applyCommand(s.ws, { operationId: 'same-op', expectedRevision: before, action: { type: 'add-task', pageId: s.ws.pages[0]!.id, sectionId: s.ws.pages[0]!.sections.find(x => x.kind === 'other')!.id, title: 'Short fingerprint' } })
  assert.equal(again.workspace.revision, s.ws.revision, 'replayed, not applied again')
  assert.equal(again.workspace.tasks.length, 1)
  assert.throws(() => applyCommand(s.ws, { operationId: 'same-op', expectedRevision: before, action: { type: 'add-task', pageId: s.ws.pages[0]!.id, sectionId: s.ws.pages[0]!.sections.find(x => x.kind === 'other')!.id, title: 'Other words' } }), /reused with different input/)
})

test('receipts written before the change still match their action, then are hashed on the next write', () => {
  const s = setup()
  const action: Action = { type: 'add-task', pageId: s.ws.pages[0]!.id, sectionId: s.ws.pages[0]!.sections.find(x => x.kind === 'other')!.id, title: 'Old format' }
  const before = s.ws.revision
  s.run(action, 'old-op')
  // As an older build stored it: the whole action as JSON.
  const ws = structuredClone(s.ws); ws.receipts['old-op']!.fingerprint = JSON.stringify(action)
  const replay = applyCommand(ws, { operationId: 'old-op', expectedRevision: before, action })
  assert.equal(replay.workspace.tasks.length, 1, 'still recognised')
  const next = applyCommand(ws, { operationId: 'later', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-17' } })
  assert.equal(next.workspace.receipts['old-op']!.fingerprint, commandFingerprint(JSON.stringify(action)), 'converted on the next write')
  assert.equal(applyCommand(next.workspace, { operationId: 'old-op', expectedRevision: before, action }).workspace.tasks.length, 1, 'and still replays after conversion')
})

test('the newest receipts are kept whole, older ones as tombstones, the oldest dropped', () => {
  const receipts: Workspace['receipts'] = {}
  const total = receiptWindow + tombstoneWindow + 50
  for (let i = 0; i < total; i++) receipts[`op-${i}`] = { operationId: `op-${i}`, message: 'Saved', fingerprint: JSON.stringify({ i }) }
  const out = compactReceipts(receipts), ids = Object.keys(out)
  assert.equal(ids.length, receiptWindow + tombstoneWindow)
  assert.equal(ids[0], 'op-50', 'the oldest 50 are gone')
  assert.deepEqual(out['op-50'], { operationId: 'op-50', message: '', fingerprint: 'expired' })
  assert.equal(out[`op-${total - receiptWindow - 1}`]!.fingerprint, 'expired', 'the newest tombstone')
  assert.equal(out[`op-${total - receiptWindow}`]!.message, 'Saved', 'the oldest whole receipt')
  assert.match(out[`op-${total - 1}`]!.fingerprint!, /^c128:/)
})

test('an expired operation is refused at its own revision and at the latest one; it is never applied again', () => {
  const s = setup(), revision = s.ws.revision
  const action: Action = { type: 'add-task', pageId: s.ws.pages[0]!.id, sectionId: s.ws.pages[0]!.sections.find(x => x.kind === 'other')!.id, title: 'Expires' }
  s.run(action, 'expiring')
  for (let i = 0; i < receiptWindow; i++) s.run({ type: 'ensure-day', date: day }, `filler-${i}`)
  assert.equal(s.ws.receipts['expiring']!.fingerprint, 'expired')
  const tasks = s.ws.tasks.length
  assert.throws(() => applyCommand(s.ws, { operationId: 'expiring', expectedRevision: revision, action }), /already applied/)
  assert.throws(() => applyCommand(s.ws, { operationId: 'expiring', expectedRevision: s.ws.revision, action }), /already applied/, 'even on the latest revision (a server replay)')
  assert.equal(s.ws.tasks.length, tasks)
})

test('an unknown old operation from the browser is refused by its revision (beyond the tombstones)', () => {
  const s = setup(), revision = s.ws.revision
  s.addTask('Moves the revision')
  assert.throws(() => applyCommand(s.ws, { operationId: 'never-seen', expectedRevision: revision, action: { type: 'ensure-day', date: day } }), /Saved elsewhere/)
})

test('the Undo copy holds no receipts, and a retry of an undone operation replays instead of applying again (Ratchet #154)', () => {
  const s = setup(), before = s.ws.revision
  const action: Action = { type: 'add-task', pageId: s.ws.pages[0]!.id, sectionId: s.ws.pages[0]!.sections.find(x => x.kind === 'other')!.id, title: 'Undone' }
  const first = s.run(action, 'to-undo')
  assert.deepEqual(s.ws.undo!.before.receipts, {})
  s.run({ type: 'undo', targetOperationId: 'to-undo' }, 'the-undo')
  assert.equal(s.ws.tasks.length, 0)
  const revision = s.ws.revision
  const retry = applyCommand(s.ws, { operationId: 'to-undo', expectedRevision: before, action })
  assert.equal(retry.workspace.tasks.length, 0, 'still undone')
  assert.equal(retry.workspace.revision, revision)
  assert.deepEqual(retry.receipt, first.receipt)
})

test('a long day of saves stays small: receipts and the Undo copy are bounded', () => {
  const s = setup(), big = 'x'.repeat(400)
  for (let i = 0; i < receiptWindow + 200; i++) s.addTask(`${big}${i}`)
  const receiptsBytes = Buffer.byteLength(JSON.stringify(s.ws.receipts))
  assert.ok(receiptsBytes < (receiptWindow + tombstoneWindow) * 120, `${receiptsBytes} bytes of receipts`)
  assert.ok(Buffer.byteLength(JSON.stringify(s.ws.undo!.before.receipts)) <= 2)
})

test('beyond the tombstones, server replays (executeOnLatest) are refused by their own state checks (Ratchet #154)', () => {
  // A replay after its tombstone is gone arrives as an unknown id on the latest revision, i.e. a fresh id here.
  const s = setup(), fresh = (() => { let n = 0; return () => `replay-${++n}` })()
  s.run({ type: 'start-draft-run', date: day, model: 'm', startedAt: '2026-10-16T08:00:00.000Z' }, 'run-1')
  assert.throws(() => s.run({ type: 'start-draft-run', date: day, model: 'm', startedAt: '2026-10-16T08:00:00.000Z' }, fresh()), /draft/i, 'a second start while drafting')
  const manifest = { lines: [], sentPages: [], omittedPages: [], taskCandidates: [], materialCandidates: [] }
  s.run({ type: 'record-draft-request', date: day, runId: 'run-1', requestHash: 'h', manifest }, 'draft-request:run-1')
  const recorded = JSON.stringify(s.ws.pages[0]!.draft)
  s.run({ type: 'record-draft-request', date: day, runId: 'run-1', requestHash: 'h', manifest }, fresh())
  assert.equal(JSON.stringify(s.ws.pages[0]!.draft), recorded, 'the same request again changes nothing')
  s.run({ type: 'model-draft-failed', date: day, runId: 'run-1', failure: 'unavailable' }, 'draft-failed:run-1')
  assert.throws(() => s.run({ type: 'model-draft-failed', date: day, runId: 'run-1', failure: 'unavailable' }, fresh()), /draft|run/i, 'a failed run fails once')
  assert.throws(() => s.run({ type: 'model-draft-failed', date: day, runId: 'run-1', failure: 'unavailable', expired: true }, fresh()), /draft|run/i, 'and expires once')
  assert.throws(() => s.run({ type: 'record-draft-request', date: day, runId: 'run-1', requestHash: 'h', manifest }, fresh()), /draft|run/i, 'no request after it ended')
})
