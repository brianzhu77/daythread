// B98: the outbox (docs/design/outbox.md). Every change he makes, except page text (the editor keeps its own drafts), is
// written here before it is sent, and deleted only once the server has it, so a reload, a closed tab or iOS killing the
// Home Screen app never loses it. One IndexedDB store; where there is none, changes are sent as before and nothing
// claims they were kept (§4).
import { applyCommand } from '../domain/workspace.ts'
import type { Action, Workspace } from '../domain/types.ts'
import { planWrites, rowsOf } from '../server/workspace-rows.ts'
import { readsBeyondApplied, writeKeys } from '../server/outbox-replay.ts'

export type HeldReason = 'conflict' | 'changed-since' | 'maybe-applied' | 'refused' | 'gone'

export interface OutboxEntry {
  /** Order he made them in, across tabs on this device. Set by the store. */
  seq?: number
  owner: string
  operationId: string
  action: Action
  baseRevision: number
  ownRevisions: number[]
  readsBeyond: boolean
  /** Row keys it was predicted to write (`task:<id>`, `page:<id>`, …) and every string its action names (§6). */
  writes: string[]
  refs: string[]
  /** `ticked "Water the plants"`, for the banner (§8.3). */
  label: string
  createdAt: number
  state: 'pending' | 'held'
  held?: { reason: HeldReason; message?: string }
}

export interface OutboxStore {
  add(entry: OutboxEntry): Promise<number>
  /** Every entry, in `seq` order. */
  all(): Promise<OutboxEntry[]>
  /**
   * Acknowledged by the server: deleted, and its revision added to every later entry of the same owner, in one
   * transaction (§4, Ratchet 0427f8d9). A receipt from before `revision` existed passes nothing on.
   */
  acknowledge(seq: number, owner: string, revision: number | undefined): Promise<void>
  update(seq: number, patch: Partial<OutboxEntry>): Promise<void>
  remove(seq: number): Promise<void>
  /** Sign-out and Delete account (§7). */
  clearOwner(owner: string): Promise<void>
}

/** For tests, and the fallback shape the IndexedDB store follows. */
export function memoryOutboxStore(): OutboxStore {
  let next = 1
  const rows = new Map<number, OutboxEntry>()
  const sorted = () => [...rows.values()].sort((a, b) => a.seq! - b.seq!)
  return {
    async add(entry) { const seq = next++; rows.set(seq, structuredClone({ ...entry, seq })); return seq },
    async all() { return sorted().map(e => structuredClone(e)) },
    async acknowledge(seq, owner, revision) {
      rows.delete(seq)
      if (revision !== undefined) for (const e of sorted()) if (e.owner === owner && e.seq! > seq && !e.ownRevisions.includes(revision)) e.ownRevisions.push(revision)
    },
    async update(seq, patch) { const e = rows.get(seq); if (e) rows.set(seq, { ...e, ...structuredClone(patch), seq }) },
    async remove(seq) { rows.delete(seq) },
    async clearOwner(owner) { for (const e of sorted()) if (e.owner === owner) rows.delete(e.seq!) },
  }
}

export function idbOutboxStore(factory: IDBFactory = indexedDB): OutboxStore {
  let db: Promise<IDBDatabase> | undefined
  const open = () => (db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('daythread-outbox', 1)
    r.onupgradeneeded = () => { const s = r.result.createObjectStore('entries', { keyPath: 'seq', autoIncrement: true }); s.createIndex('owner', 'owner') }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { db = undefined; reject(r.error) }
  }))
  /** One transaction; resolves when it has committed, not when its requests have answered. */
  const tx = async <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> => {
    const t = (await open()).transaction('entries', mode, { durability: 'strict' } as IDBTransactionOptions)
    let value: T
    return new Promise<T>((resolve, reject) => {
      t.oncomplete = () => resolve(value)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error ?? new Error('Outbox transaction aborted'))
      work(t.objectStore('entries'), v => { value = v })
    })
  }
  const later = (store: IDBObjectStore, owner: string, after: number, each: (e: OutboxEntry, cursor: IDBCursorWithValue) => void) => {
    const r = store.index('owner').openCursor(IDBKeyRange.only(owner))
    r.onsuccess = () => { const c = r.result; if (!c) return; const e = c.value as OutboxEntry; if (e.seq! > after) each(e, c); c.continue() }
  }
  return {
    add: entry => tx<number>('readwrite', (s, done) => { const { seq: _seq, ...rest } = entry; const r = s.add(rest); r.onsuccess = () => done(Number(r.result)) }),
    all: () => tx<OutboxEntry[]>('readonly', (s, done) => { const r = s.getAll(); r.onsuccess = () => done((r.result as OutboxEntry[]).sort((a, b) => a.seq! - b.seq!)) }),
    acknowledge: (seq, owner, revision) => tx<void>('readwrite', s => {
      s.delete(seq)
      if (revision !== undefined) later(s, owner, seq, (e, c) => { if (!e.ownRevisions.includes(revision)) c.update({ ...e, ownRevisions: [...e.ownRevisions, revision] }) })
    }),
    update: (seq, patch) => tx<void>('readwrite', s => { const r = s.get(seq); r.onsuccess = () => { if (r.result) s.put({ ...r.result, ...patch, seq }) } }),
    remove: seq => tx<void>('readwrite', s => { s.delete(seq) }),
    clearOwner: owner => tx<void>('readwrite', s => later(s, owner, 0, (_e, c) => { c.delete() })),
  }
}

/** Every string an action names: the ids it may depend on, over-approximated on purpose (§6). */
export function referencedIds(action: Action): string[] {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.length && v.length <= 200) out.add(v) }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(action)
  out.delete(action.type)
  return [...out]
}

/** The id inside a row key: `task:abc` → `abc`. */
const idOf = (key: string) => key.slice(key.indexOf(':') + 1)

/** Whether `entry` must wait for `held` (§6): their writes meet, it names something the held one wrote or made, or it reads beyond its writes. */
export function dependsOn(entry: Pick<OutboxEntry, 'writes' | 'refs' | 'readsBeyond'>, held: Pick<OutboxEntry, 'writes'>): boolean {
  if (entry.readsBeyond) return true
  const writes = new Set(held.writes), ids = new Set(held.writes.map(idOf))
  return entry.writes.some(k => writes.has(k)) || entry.refs.some(id => ids.has(id))
}

/** The banner's words for a change (Jazz §8.3): a past-tense verb and the item's name, cut at 40 characters. */
export function labelFor(action: Action, ws: Workspace): string {
  const cut = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s)
  const page = (id: string | undefined) => (id ? ws.pages.find(p => p.id === id) : undefined)
  const task = (id: string | undefined) => (id ? ws.tasks.find(t => t.id === id) : undefined)
  const a = action as Action & { taskId?: string; pageId?: string; title?: string; status?: string; rowId?: string }
  const name = task(a.taskId)?.title || page(a.rowId ?? a.pageId)?.title || a.title
  const quoted = name ? `"${cut(name)}"` : null
  switch (action.type) {
    case 'task-status': return quoted ? `${a.status === 'done' ? 'ticked' : a.status === 'open' ? 'unticked' : 'changed'} ${quoted}` : 'a change'
    case 'add-task': case 'add-row': case 'add-rows': return quoted ? `added ${quoted}` : 'added a row'
    case 'rename-task': case 'rename-page': return quoted ? `renamed ${quoted}` : 'a rename'
    case 'move-row': case 'move-page': return quoted ? `moved ${quoted}` : 'a move'
    case 'delete-page': case 'delete-pages': case 'remove-task-row': return quoted ? `deleted ${quoted}` : 'a delete'
    case 'run-button': case 'run-row-button': return quoted ? `ran ${quoted}` : 'ran a button'
    case 'undo': return 'an Undo'
    default: return quoted ? `a change on ${quoted}` : 'a change'
  }
}

export interface Captured { entry: Omit<OutboxEntry, 'seq' | 'owner' | 'baseRevision' | 'ownRevisions' | 'createdAt' | 'state'>; predicted: Workspace | null }

/**
 * A change as he made it (§4): applied to the predicted workspace with the domain's own code, so its write set, the ids
 * it names and whether it reads beyond what it writes are known before it is sent. `undo` can't be predicted (the
 * browser has no copy to restore) and is taken as reading beyond; so is anything made while an Undo is pending.
 */
export function capture(predicted: Workspace, action: Action, operationId: string, undoPending: boolean): Captured {
  const base = { operationId, action, refs: referencedIds(action), label: labelFor(action, predicted) }
  if (action.type === 'undo') return { entry: { ...base, readsBeyond: true, writes: [] }, predicted: null }
  try {
    const result = applyCommand(predicted, { operationId, expectedRevision: predicted.revision, action })
    const writes = writeKeys(planWrites(rowsOf(predicted), result.workspace).write)
    return { entry: { ...base, readsBeyond: undoPending || readsBeyondApplied(action, result.receipt), writes }, predicted: result.workspace }
  } catch {
    // Refused here, likely refused there too: still stored and sent, so the answer is the server's.
    return { entry: { ...base, readsBeyond: true, writes: [] }, predicted: null }
  }
}
