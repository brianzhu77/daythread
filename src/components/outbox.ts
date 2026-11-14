// B98: the outbox (docs/design/outbox.md). Every change he makes, except page text (the editor keeps its own drafts), is
// written here before it is sent, and deleted only once the server has it, so a reload, a closed tab or iOS killing the
// Home Screen app never loses it. One IndexedDB store; where there is none, changes are sent as before and nothing
// claims they were kept (§4).
import { applyCommand } from '../domain/workspace.ts'
import type { Action, Workspace } from '../domain/types.ts'
import { readsBeyondApplied } from '../server/outbox-replay.ts'
import { linkId } from '../domain/task-links.ts'

/**
 * The rows a change was predicted to write, by id, in the same keys the server's row check uses (`page:`, `task:`, …).
 * Compared on the domain's own objects, not the stored rows the server diffs (that code would add ~130 KB to the page,
 * R1-18): a pure reorder isn't seen here, but the ids a change names are (§6), so a dependency on it still is.
 */
export function predictedWrites(before: Workspace, after: Workspace): string[] {
  const keys: string[] = []
  const diff = <E extends { id: string }>(kind: string, was: readonly E[] | undefined, is: readonly E[] | undefined) => {
    const old = new Map((was ?? []).map(e => [e.id, JSON.stringify(e)])), now = new Set<string>()
    for (const e of is ?? []) { now.add(e.id); if (old.get(e.id) !== JSON.stringify(e)) keys.push(`${kind}:${e.id}`) }
    for (const id of old.keys()) if (!now.has(id)) keys.push(`${kind}:${id}`)
  }
  // Synced blocks' records and smart notes are stored as page rows.
  diff('page', [...before.pages, ...(before.synced ?? []), ...(before.smartNotes ?? [])] as Array<{ id: string }>, [...after.pages, ...(after.synced ?? []), ...(after.smartNotes ?? [])] as Array<{ id: string }>)
  diff('task', before.tasks, after.tasks); diff('deleted', before.deletedTasks, after.deletedTasks)
  diff('thread', before.threads, after.threads); diff('link', (before.links ?? []).map(l => ({ ...l, id: linkId(l) })), (after.links ?? []).map(l => ({ ...l, id: linkId(l) })))
  if (before.timezone !== after.timezone || (before.weekStart ?? 0) !== (after.weekStart ?? 0) || JSON.stringify(before.todoAutomations ?? null) !== JSON.stringify(after.todoAutomations ?? null)) keys.push('settings')
  return keys
}

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
  /** A write the app makes by itself (§6, Jazz 8887e299): not counted, never held; dropped silently when replay finds it unneeded. */
  app?: boolean
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

/** Writes the app makes by itself, not he (Lead b19f29b0): opening a day, the day draft, repeats, a smart note's answer. */
export const appWrites: ReadonlySet<string> = new Set(['ensure-day', 'set-draft', 'skip-draft', 'run-repeats', 'set-smart-note-result'])

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

/**
 * Whether a change must wait (§6): it depends on a held change, or on one that is itself waiting, transitively (Ratchet
 * 12c9599b: a rename of a row whose add waits on its held database must wait too, not be sent and refused).
 */
export function blockedBy(all: readonly OutboxEntry[], entry: OutboxEntry): boolean {
  const blockers: OutboxEntry[] = []
  for (const e of [...all].sort((a, b) => a.seq! - b.seq!)) {
    if (e.seq! >= entry.seq!) break
    if (e.state === 'held' && !e.app) blockers.push(e)
    else if (e.state === 'pending' && blockers.some(b => dependsOn(e, b))) blockers.push(e)
  }
  return blockers.some(b => dependsOn(entry, b))
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
    const writes = predictedWrites(predicted, result.workspace)
    return { entry: { ...base, readsBeyond: undoPending || readsBeyondApplied(action, result.receipt), writes }, predicted: result.workspace }
  } catch {
    // Refused here, likely refused there too: still stored and sent, so the answer is the server's.
    return { entry: { ...base, readsBeyond: true, writes: [] }, predicted: null }
  }
}
