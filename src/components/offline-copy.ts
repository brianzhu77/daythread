// The last-loaded copy of the workspace (docs/design/pwa.md §2): kept in the browser after every successful load,
// used only when a load fails for lack of network, dropped on sign-out. One record in IndexedDB; where there is
// none (private mode), the copy is simply absent and the app behaves as before.
import type { Workspace } from '../domain/types'

export interface CopyStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/** A fetch that never reached the server: Chromium, WebKit and Node word it differently; the browser may also say so outright. */
export function isNetworkFailure(error: unknown, nav: { onLine?: boolean } = typeof navigator !== 'undefined' ? navigator : {}): boolean {
  if (nav.onLine === false) return true
  return error instanceof TypeError && /fetch|load failed|network/i.test(error.message)
}

const key = 'workspace'

export class OfflineCopy {
  private readonly store: CopyStore
  constructor(store: CopyStore) { this.store = store }
  /** After a successful load or save. A copy newer than this one (another tab's) is kept. */
  async remember(ws: Workspace): Promise<void> {
    try {
      const have = (await this.store.get(key)) as Workspace | undefined
      if (have && have.revision > ws.revision) return
      await this.store.set(key, ws)
    } catch { /* no store: no copy */ }
  }
  async recall(): Promise<Workspace | null> {
    try { return ((await this.store.get(key)) as Workspace | undefined) ?? null } catch { return null }
  }
  /** The copy, when the network is why a load failed; nothing for any other failure (signed out, a server error). */
  async fallback(error: unknown): Promise<Workspace | null> {
    return isNetworkFailure(error) ? this.recall() : null
  }
  async forget(): Promise<void> {
    try { await this.store.remove(key) } catch { /* nothing to drop */ }
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
    set: async (k, v) => { await run('readwrite', s => s.put(v, k)) },
    remove: async k => { await run('readwrite', s => s.delete(k)) },
  }
}
const noStore: CopyStore = { get: async () => undefined, set: async () => undefined, remove: async () => undefined }

export const offlineCopy = new OfflineCopy(typeof indexedDB !== 'undefined' ? idbStore() : noStore)

/** Sign-out and Delete account: the copy and the worker's caches go, so nothing of this account stays on the device. */
export async function clearOfflineData(): Promise<void> {
  await offlineCopy.forget()
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('daythread-')) await caches.delete(k) } catch { /* nothing cached */ }
}
