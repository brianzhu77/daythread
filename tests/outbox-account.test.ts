// B98 item 5 (outbox.md §7, Ratchet 241fda62): Delete account takes the account's stored changes off the device when it
// goes through, and keeps them when it's refused; clearing one account's changes leaves another's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterDeletion, memoryOutboxStore, type OutboxEntry } from '../src/components/outbox.ts'
import type { Action } from '../src/domain/types.ts'

const entry = (owner: string): OutboxEntry => ({ owner, operationId: `op-${owner}`, action: { type: 'undo' } as Action, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: [], refs: [], label: '', createdAt: 0, state: 'pending' })

test('a successful deletion clears the account\'s outbox, then its offline data; a refused one keeps both', async () => {
  const store = memoryOutboxStore()
  await store.add(entry('deleted-account')); await store.add(entry('someone-else'))
  const order: string[] = []
  const steps = { clearOutbox: async () => { order.push('outbox'); await store.clearOwner('deleted-account') }, clearOfflineData: async () => { order.push('offline') } }
  assert.equal(await afterDeletion(false, steps), false)
  assert.deepEqual(order, [], 'refused: nothing cleared')
  assert.equal((await store.all()).length, 2)
  assert.equal(await afterDeletion(true, steps), true)
  assert.deepEqual(order, ['outbox', 'offline'])
  assert.deepEqual((await store.all()).map(e => e.owner), ['someone-else'], 'only that account\'s changes leave')
})
