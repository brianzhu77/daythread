// Independent boundary probe for a stale handoff token after an owner change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryOutboxStore, type OutboxEntry } from '../src/components/outbox.ts'

test('a handoff for another owner preserves the original and stores no replacement', async () => {
  const store = memoryOutboxStore()
  const original = { owner: 'a', operationId: 'original', action: { type: 'undo', targetOperationId: 'earlier' }, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: [], refs: [], label: 'original', createdAt: 0, state: 'held' } as OutboxEntry
  const seq = await store.add(original)
  const before = await store.all()
  try { await store.handOff(seq, 'b', { ...original, owner: 'b', operationId: 'replacement' }) } catch { /* refusing is valid */ }
  assert.deepEqual(await store.all(), before, 'the token cannot retire another owner’s original or enqueue its replacement')
})
