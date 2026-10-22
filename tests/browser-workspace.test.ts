import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'

const day = (operationId: string, expectedRevision: number, date: string) => ({ operationId, expectedRevision, action: { type: 'ensure-day' as const, date } })

test('the browser copy has no receipts and only the Undo marker, and keeps everything else', () => {
  let w = createEmptyWorkspace()
  w = applyCommand(w, day('d1', 0, '2026-10-17')).workspace
  const page = w.pages[0]!
  w = applyCommand(w, { operationId: 't1', expectedRevision: w.revision, action: { type: 'add-task', pageId: page.id, sectionId: page.sections[0]!.id, title: 'Call' } }).workspace
  assert.ok(Object.keys(w.receipts).length > 0 && w.undo?.before)
  const sent = forBrowser(w)
  assert.deepEqual(sent.receipts, {})
  assert.deepEqual(sent.undo, { operationId: 't1', revision: w.revision })
  const { receipts: _a, undo: _b, ...rest } = w, { receipts: _c, undo: _d, ...sentRest } = sent
  assert.deepEqual(sentRest, rest)
})

test('previews in the browser still apply commands to the browser copy, and Undo is never applied there', () => {
  let w = createEmptyWorkspace()
  w = applyCommand(w, day('d1', 0, '2026-10-17')).workspace
  const page = w.pages[0]!
  w = applyCommand(w, { operationId: 't1', expectedRevision: w.revision, action: { type: 'add-task', pageId: page.id, sectionId: page.sections[0]!.id, title: 'Call' } }).workspace
  const sent = forBrowser(w)
  const preview = applyCommand(sent, { operationId: 't2', expectedRevision: sent.revision, action: { type: 'add-task', pageId: page.id, sectionId: page.sections[0]!.id, title: 'Write' } }).workspace
  const server = applyCommand(w, { operationId: 't2', expectedRevision: w.revision, action: { type: 'add-task', pageId: page.id, sectionId: page.sections[0]!.id, title: 'Write' } }).workspace
  const lines = (x: typeof w) => x.pages.flatMap(p => p.sections.flatMap(s => s.blocks.map(b => `${s.kind}:${b.kind}:${b.text}`)))
  assert.deepEqual(lines(preview), lines(server))
  assert.deepEqual(preview.tasks.map(t => t.title), server.tasks.map(t => t.title))
  // Undo needs the copy, which only the server has: refused in the browser, applied on the server.
  assert.throws(() => applyCommand(sent, { operationId: 'u', expectedRevision: sent.revision, action: { type: 'undo', targetOperationId: 't1' } }), /Cannot undo/)
  assert.equal(applyCommand(w, { operationId: 'u', expectedRevision: w.revision, action: { type: 'undo', targetOperationId: 't1' } }).workspace.tasks.length, 0)
})

test('a resent command is still deduplicated on the server, which keeps the receipts the browser no longer gets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daythread-browser-'))
  try {
    const repository = new SqliteWorkspaceRepository(join(directory, 'w.sqlite'))
    const first = await repository.execute(day('resend', 0, '2026-10-17'))
    const sent = forBrowser(first.workspace)
    assert.deepEqual(sent.receipts, {})
    // The response was lost; the browser resends the same operation from its old copy.
    const again = await repository.execute(day('resend', 0, '2026-10-17'))
    assert.equal(again.receipt.operationId, 'resend')
    assert.equal(again.workspace.revision, first.workspace.revision)
    assert.equal((await repository.load()).pages.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
