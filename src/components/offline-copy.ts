// The last-loaded copy of the workspace (docs/design/pwa.md §2): kept in the browser after every successful load,
// used only when a load fails for lack of network, dropped on sign-out and on every sign-in. One record in IndexedDB;
// where there is none (private mode), the copy is simply absent and the app behaves as before.
import type { Workspace } from '../domain/types'

export interface CopyStore {
  get(key: string): Promise<unknown>
  /**
   * Reads the key and writes `next(current)` in one transaction (`undefined`: leave it), so nothing lands between the
   * read and the write: a clear can't be overwritten by a decision made on what was there before it (Ratchet #222).
   */
  update(key: string, next: (current: unknown) => unknown): Promise<void>
}

/** A fetch that never reached the server: Chromium, WebKit and Node word it differently; the browser may also say so outright. */
export function isNetworkFailure(error: unknown, nav: { onLine?: boolean } = typeof navigator !== 'undefined' ? navigator : {}): boolean {
  if (nav.onLine === false) return true
  return error instanceof TypeError && /fetch|load failed|network/i.test(error.message)
}

const key = 'workspace'

/**
 * Who a server response belongs to: the account the server ran it as (`local` with sign-in off), and when the browser
 * sent the request (`Date.now()`), so a reply that was already in flight when the account changed can be told apart.
 */
export interface CopyStamp { owner: string; startedAt: number }

/**
 * The stored record: whose workspace it is and from when that holds. `owner` null is a cleared slot (sign-in, sign-out):
 * it keeps `since`, so a reply sent before the clear can't write the previous account's workspace back.
 */
interface CopyRecord { owner: string | null; since: number; workspace: Workspace | null }
const isRecord = (v: unknown): v is CopyRecord => typeof v === 'object' && v !== null && 'owner' in v && 'since' in v && 'workspace' in v

export class OfflineCopy {
  private readonly store: CopyStore
  private readonly now: () => number
  constructor(store: CopyStore, now: () => number = Date.now) { this.store = store; this.now = now }
  /**
   * After a successful load or save. The same account: a newer copy (another tab's) is kept. Another account (or a
   * cleared slot): replaced only by a request sent after the slot became that account's, so a late reply from the
   * previous account never overwrites the next one's copy (Ratchet, #24).
   */
  async remember(ws: Workspace, stamp: CopyStamp): Promise<void> {
    try {
      await this.store.update(key, raw => {
        const have = isRecord(raw) ? raw : undefined
        if (have?.owner === stamp.owner) { if (have.workspace && have.workspace.revision > ws.revision) return undefined }
        else if (have && stamp.startedAt < have.since) return undefined
        const since = have?.owner === stamp.owner ? have.since : stamp.startedAt
        return { owner: stamp.owner, since, workspace: ws } satisfies CopyRecord
      })
    } catch { /* no store: no copy */ }
  }
  async recall(): Promise<Workspace | null> {
    try { const raw = await this.store.get(key); return isRecord(raw) ? raw.workspace : null } catch { return null }
  }
  /** The copy, when the network is why a load failed; nothing for any other failure (signed out, a server error). */
  async fallback(error: unknown): Promise<Workspace | null> {
    return isNetworkFailure(error) ? this.recall() : null
  }
  /** Sign-in, sign-out, Delete account: the slot is emptied and belongs to no one until a request sent from now on answers. */
  async forget(): Promise<void> {
    try { await this.store.update(key, () => ({ owner: null, since: this.now(), workspace: null }) satisfies CopyRecord) } catch { /* nothing to drop */ }
  }
}

function idbStore(): CopyStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('daythread-offline', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'))
      t.oncomplete = () => { db.close(); resolve(req.result) }
      t.onerror = () => { db.close(); reject(t.error) }
      t.onabort = () => { db.close(); reject(t.error) }
    })
  }
  return {
    get: k => run('readonly', s => s.get(k)),
    // IndexedDB runs readwrite transactions on one store one at a time; the put is issued from the get's own success
    // callback, inside the same transaction, so the read and the write are one step.
    update: async (k, next) => {
      await run('readwrite', s => {
        const req = s.get(k)
        req.onsuccess = () => { const value = next(req.result); if (value !== undefined) s.put(value, k) }
        return req
      })
    },
  }
}
const noStore: CopyStore = { get: async () => undefined, update: async () => undefined }

export const offlineCopy = new OfflineCopy(typeof indexedDB !== 'undefined' ? idbStore() : noStore)

/** Sign-out and Delete account: the copy and the worker's caches go, so nothing of this account stays on the device. */
export async function clearOfflineData(): Promise<void> {
  await offlineCopy.forget()
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('daythread-')) await caches.delete(k) } catch { /* nothing cached */ }
}

/** A session just began (sign-in, sign-up, a confirmed or reset link) and may be another account's: the copy goes first. */
export async function enterApp(to: string): Promise<void> {
  await offlineCopy.forget()
  window.location.assign(to)
}
