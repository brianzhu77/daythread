import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OfflineCopy, isNetworkFailure, type CopyStore } from '../src/components/offline-copy.ts'
import type { Workspace } from '../src/domain/types.ts'

// The last-loaded copy of the workspace (docs/design/pwa.md §2): written after a successful load, read only when the
// network is why a load failed, dropped on sign-out.
const ws = (revision: number): Workspace => ({ schemaVersion: 2, revision, timezone: 'UTC', pages: [], tasks: [], deletedTasks: [], receipts: {} })
const memory = (): CopyStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>()
  return { data, get: async k => data.get(k), set: async (k, v) => { data.set(k, v) } }
}
const a = (startedAt: number) => ({ owner: 'account-a', startedAt }), b = (startedAt: number) => ({ owner: 'account-b', startedAt })

test('isNetworkFailure: a failed fetch in Chromium, WebKit and Node, or no connection; never a refusal or a server error', () => {
  for (const e of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('fetch failed'), new TypeError('NetworkError when attempting to fetch resource.')]) assert.equal(isNetworkFailure(e), true, e.message)
  assert.equal(isNetworkFailure(new Error('signed-out')), false)
  assert.equal(isNetworkFailure(new Error('Internal Server Error')), false)
  assert.equal(isNetworkFailure(Object.assign(new Error('x'), { status: 401 })), false)
  assert.equal(isNetworkFailure(new Error('anything'), { onLine: false }), true, 'the browser says it is offline')
})

test('OfflineCopy: remember after a load, recall only on a network failure, forget on sign-out', async () => {
  const store = memory(), copy = new OfflineCopy(store)
  assert.equal(await copy.recall(), null, 'nothing yet')
  await copy.remember(ws(3), a(1))
  await copy.remember(ws(5), a(2))
  assert.equal((await copy.recall())?.revision, 5, 'the latest copy')
  await copy.remember(ws(4), a(3))
  assert.equal((await copy.recall())?.revision, 5, 'an older revision never replaces a newer copy')
  assert.equal((await copy.fallback(new TypeError('Failed to fetch')))?.revision, 5, 'a network failure gets the copy')
  assert.equal(await copy.fallback(new Error('signed-out')), null, 'a refusal never gets the copy')
  await copy.forget()
  assert.equal(await copy.recall(), null)
  assert.equal(await copy.fallback(new TypeError('Failed to fetch')), null, 'nothing after sign-out')
})

test('OfflineCopy: a store that throws (private mode, no IndexedDB) is a copy that is simply absent', async () => {
  const broken: CopyStore = { get: async () => { throw new Error('no idb') }, set: async () => { throw new Error('no idb') } }
  const copy = new OfflineCopy(broken)
  await copy.remember(ws(1), a(1))
  assert.equal(await copy.recall(), null)
  assert.equal(await copy.fallback(new TypeError('Failed to fetch')), null)
  await copy.forget()
})

// Ratchet #222: one slot per browser held account A's copy after B loaded, because B's lower revision was refused.
test('OfflineCopy: another account always replaces the copy, whatever its revision', async () => {
  const store = memory(), copy = new OfflineCopy(store)
  await copy.remember(ws(100), a(1))
  await copy.remember(ws(3), b(2))
  assert.equal((await copy.recall())?.revision, 3, "B's copy, not A's revision 100")
  assert.equal((await copy.fallback(new TypeError('Failed to fetch')))?.revision, 3, 'offline shows B')
  await copy.remember(ws(2), b(3))
  assert.equal((await copy.recall())?.revision, 3, 'within B, an older revision still never replaces a newer copy')
})

test("OfflineCopy: a reply sent before the account changed never writes the previous account's copy back", async () => {
  const copy = new OfflineCopy(memory())
  await copy.remember(ws(100), a(1))
  await copy.remember(ws(3), b(10))
  await copy.remember(ws(101), a(5))
  assert.equal((await copy.recall())?.revision, 3, "A's save sent at 5 answered after B's load sent at 10: dropped")
  await copy.remember(ws(102), a(20))
  assert.equal((await copy.recall())?.revision, 102, 'A signed in again later: its new load replaces B')
})

test('OfflineCopy: a sign-in clears the slot, and only requests sent after it can fill it', async () => {
  let now = 0
  const copy = new OfflineCopy(memory(), () => now)
  await copy.remember(ws(100), a(1))
  now = 10
  await copy.forget()
  assert.equal(await copy.fallback(new TypeError('Failed to fetch')), null, 'signed in, then offline before any load: no copy at all')
  await copy.remember(ws(101), a(5))
  assert.equal(await copy.recall(), null, 'a reply sent before the sign-in is dropped, even from the same account')
  await copy.remember(ws(3), b(11))
  assert.equal((await copy.recall())?.revision, 3, 'the new session fills it')
})

test('OfflineCopy: a record in the earlier one-workspace format is no copy, and the next load replaces it', async () => {
  const store = memory(), copy = new OfflineCopy(store)
  store.data.set('workspace', ws(100))
  assert.equal(await copy.recall(), null, 'whose it was is unknown')
  await copy.remember(ws(3), b(1))
  assert.equal((await copy.recall())?.revision, 3)
})
