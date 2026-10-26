import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OfflineCopy, isNetworkFailure, type CopyStore } from '../src/components/offline-copy.ts'
import type { Workspace } from '../src/domain/types.ts'

// The last-loaded copy of the workspace (docs/design/pwa.md §2): written after a successful load, read only when the
// network is why a load failed, dropped on sign-out.
const ws = (revision: number): Workspace => ({ schemaVersion: 2, revision, timezone: 'UTC', pages: [], tasks: [], deletedTasks: [], receipts: {} })
const memory = (): CopyStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>()
  return { data, get: async k => data.get(k), set: async (k, v) => { data.set(k, v) }, remove: async k => { data.delete(k) } }
}

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
  await copy.remember(ws(3))
  await copy.remember(ws(5))
  assert.equal((await copy.recall())?.revision, 5, 'the latest copy')
  await copy.remember(ws(4))
  assert.equal((await copy.recall())?.revision, 5, 'an older revision never replaces a newer copy')
  assert.equal((await copy.fallback(new TypeError('Failed to fetch')))?.revision, 5, 'a network failure gets the copy')
  assert.equal(await copy.fallback(new Error('signed-out')), null, 'a refusal never gets the copy')
  await copy.forget()
  assert.equal(await copy.recall(), null)
  assert.equal(await copy.fallback(new TypeError('Failed to fetch')), null, 'nothing after sign-out')
})

test('OfflineCopy: a store that throws (private mode, no IndexedDB) is a copy that is simply absent', async () => {
  const broken: CopyStore = { get: async () => { throw new Error('no idb') }, set: async () => { throw new Error('no idb') }, remove: async () => { throw new Error('no idb') } }
  const copy = new OfflineCopy(broken)
  await copy.remember(ws(1))
  assert.equal(await copy.recall(), null)
  assert.equal(await copy.fallback(new TypeError('Failed to fetch')), null)
  await copy.forget()
})
