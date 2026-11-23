// B98: the outbox (docs/design/outbox.md). Every change he makes, except page text (the editor keeps its own drafts), is
// written here before it is sent, and deleted only once the server has it, so a reload, a closed tab or iOS killing the
// Home Screen app never loses it. One IndexedDB store; where there is none, changes are sent as before and nothing
// claims they were kept (§4).
import { applyCommand } from '../domain/workspace.ts'
import { draftOf } from '../domain/day-draft.ts'
import type { Action, Page, Receipt, Workspace } from '../domain/types.ts'
import { idsOfKey, pageKeys } from '../domain/conflict-keys.ts'
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
  // Synced blocks' records and smart notes are stored as page rows. Inside a page, the parts it changed (conflict-keys.ts).
  const pagesOf = (ws: Workspace) => new Map([...ws.pages, ...(ws.synced ?? []), ...(ws.smartNotes ?? [])].map(p => [(p as { id: string }).id, p as Page]))
  const was = pagesOf(before), now = pagesOf(after)
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id), b = now.get(id)
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) keys.push(...pageKeys(a, b).writes)
  }
  diff('task', before.tasks, after.tasks); diff('deleted', before.deletedTasks, after.deletedTasks)
  diff('thread', before.threads, after.threads); diff('link', (before.links ?? []).map(l => ({ ...l, id: linkId(l) })), (after.links ?? []).map(l => ({ ...l, id: linkId(l) })))
  if (before.timezone !== after.timezone || (before.weekStart ?? 0) !== (after.weekStart ?? 0) || JSON.stringify(before.todoAutomations ?? null) !== JSON.stringify(after.todoAutomations ?? null)) keys.push('settings')
  return keys
}

/** Tap feedback §2.6: a day draft decision stored and not answered yet. `undone`: an Undo of it (or a skip's reopen) is stored after it. */
export interface DraftDecision { operationId: string; type: 'apply-draft' | 'skip-draft' | 'move-draft'; pageId: string; itemIds: string[]; undone: boolean }

/**
 * The draft decisions among `entries` still on their way (`pending`), so a band shows what he decided from the stored
 * change itself; or (`held`) those the server held, which the band says in place until he picks Keep mine or Discard.
 */
export function draftDecisions(entries: readonly OutboxEntry[], state: OutboxEntry['state'] = 'pending'): DraftDecision[] {
  const live = entries.filter(e => e.state === state)
  const undoing = new Set(live.flatMap(e => e.action.type === 'undo' ? [e.action.targetOperationId] : e.action.type === 'reopen-draft' ? [e.action.skippedBy] : []))
  return live.flatMap((e): DraftDecision[] => e.action.type === 'apply-draft' || e.action.type === 'skip-draft'
    ? [{ operationId: e.operationId, type: e.action.type, pageId: e.action.pageId, itemIds: e.action.itemIds, undone: undoing.has(e.operationId) }]
    // The row's Another day (#377): its item is decided (skipped) from the moment it's stored, like a ✕.
    : e.action.type === 'move-draft' ? [{ operationId: e.operationId, type: e.action.type, pageId: e.action.pageId, itemIds: [e.action.itemId], undone: undoing.has(e.operationId) }]
    : [])
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
  /** `stale`: held only because the workspace moved on (SendAnswer); a caller that rebuilds such a change says nothing is lost. */
  held?: { reason: HeldReason; message?: string; stale?: true }
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
  /**
   * A change given back to its caller leaves the outbox (Lead bd4cc39e, Ratchet 6804fae5), in one transaction: what
   * replaces it (its rebuild) is stored, every change of the owner still waiting on it, from any tab, is held for him
   * to decide, and it's removed. Nothing changes if any part fails. The replacement's seq, or null; `not-held` and
   * nothing changed when the original isn't this owner's held change any more (another tab chose Keep mine, or it's
   * gone: Ratchet 23351123).
   */
  handOff(seq: number, owner: string, replacement: OutboxEntry | null): Promise<number | null | 'not-held'>
}

/** What a hand-off does to an owner's queue, as stored now: the changes to hold. Pure, so both stores do the same. */
export function handOffHolds(queue: readonly OutboxEntry[], seq: number): number[] {
  return [...schedule(queue).waiting].filter(([, roots]) => roots.includes(seq)).map(([w]) => w)
}
const handOffHeld = { state: 'held' as const, held: { reason: 'changed-since' as const } }
/**
 * Whether the original is still this owner's change held for its caller. The app's own write was already dropped when
 * it was held (`drainQueue`), so for its rebuild a missing original is expected; for his, missing means another tab
 * discarded it, and a pending one means another tab chose Keep mine: either way the rebuild isn't stored too.
 */
function originalStill(original: OutboxEntry | undefined, owner: string, replacement: OutboxEntry | null): boolean {
  if (replacement && replacement.owner !== owner) return false
  if (!original) return Boolean(replacement?.app)
  return original.owner === owner && original.state === 'held'
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
    async handOff(seq, owner, replacement) {
      if (!originalStill(rows.get(seq), owner, replacement)) return 'not-held'
      const queue = sorted().filter(e => e.owner === owner)
      for (const w of handOffHolds(queue, seq)) rows.set(w, { ...rows.get(w)!, ...structuredClone(handOffHeld) })
      rows.delete(seq)
      if (!replacement) return null
      const at = next++; rows.set(at, structuredClone({ ...replacement, seq: at })); return at
    },
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
    handOff: (seq, owner, replacement) => tx<number | null | 'not-held'>('readwrite', (s, done) => {
      // The original by its seq, whoever's it is, as the memory store sees it (Ratchet 61ef1bab); then the owner's queue.
      const got = s.get(seq)
      got.onsuccess = () => {
        if (!originalStill(got.result as OutboxEntry | undefined, owner, replacement)) { done('not-held'); return }
        const r = s.index('owner').getAll(IDBKeyRange.only(owner))
        r.onsuccess = () => {
          const queue = (r.result as OutboxEntry[]).sort((a, b) => a.seq! - b.seq!)
          for (const w of handOffHolds(queue, seq)) s.put({ ...queue.find(e => e.seq === w)!, ...handOffHeld })
          s.delete(seq)
          if (!replacement) { done(null); return }
          const { seq: _seq, ...rest } = replacement
          const added = s.add(rest); added.onsuccess = () => done(Number(added.result))
        }
      }
    }),
  }
}

/**
 * Writes the app makes by itself, not he (Lead b19f29b0): opening a day, the day draft, repeats, a smart note's answer.
 * Not `skip-draft`: only his ✕ and Dismiss send it, so when the server holds it he must hear it, in place and in the
 * banner, like any change of his (Ratchet 85c5939a); an app write that's held is dropped without a word.
 */
export const appWrites: ReadonlySet<string> = new Set(['ensure-day', 'set-draft', 'run-repeats', 'set-smart-note-result'])

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

/**
 * Whether `entry` must wait for `held` (§6): their writes meet, it names something the held one made, removed or wrote
 * as a whole row (a page, view or widget's lifecycle, a task), or it reads beyond its writes. A part inside a page names
 * nothing, so sibling parts of one page don't wait on each other (Ratchet 58a63858).
 */
export function dependsOn(entry: Pick<OutboxEntry, 'writes' | 'refs' | 'readsBeyond'>, held: Pick<OutboxEntry, 'writes'>): boolean {
  if (entry.readsBeyond) return true
  const writes = new Set(held.writes), ids = new Set(held.writes.flatMap(idsOfKey))
  return entry.writes.some(k => writes.has(k)) || entry.refs.some(id => ids.has(id))
}

/** What the server made of a sent change (§5, §11). `offline`, `failed` and `missing` are passing: the change stays pending. */
export type SendAnswer =
  | { status: 'applied'; workspace: Workspace; receipt: Receipt }
  | { status: 'already-applied' }
  /** `stale`: held only because the workspace moved on since it was made (a part it writes changed elsewhere, or it reads beyond and anything moved). */
  | { status: 'held'; reason: HeldReason; message?: string; stale?: true }
  | { status: 'owner-mismatch' }
  | { status: 'offline' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }

/** One owner's queue, split (§6): every pending entry is either sendable or waiting, never both. */
export interface Schedule {
  /** Pending entries free to go now, in `seq` order. */
  sendable: OutboxEntry[]
  /** Held entries, in `seq` order. */
  held: OutboxEntry[]
  /** Pending entries that wait, by `seq`: the held entries they wait on, directly or through another waiting one (Ratchet 12c9599b). */
  waiting: Map<number, number[]>
}

/**
 * The one place that decides what may be sent (Lead 150bd86f). A pending change waits when it depends on a held change
 * of his, or on a change that is itself waiting; everything else pending is sendable, oldest first. Which tab stored an
 * entry, or whether that tab is still open, plays no part.
 */
export function schedule(queue: readonly OutboxEntry[]): Schedule {
  const sendable: OutboxEntry[] = [], held: OutboxEntry[] = [], waiting = new Map<number, number[]>()
  const blockers: Array<{ entry: OutboxEntry; roots: number[] }> = []
  const seen = new Set<number>()
  for (const e of [...queue].sort((a, b) => a.seq! - b.seq!)) {
    if (seen.has(e.seq!)) continue
    seen.add(e.seq!)
    if (e.state === 'held') {
      held.push(e)
      // The app's own write is never held for long: it's dropped when replay finds it unneeded.
      if (!e.app) blockers.push({ entry: e, roots: [e.seq!] })
      continue
    }
    const roots = new Set<number>()
    for (const b of blockers) if (dependsOn(e, b.entry)) for (const r of b.roots) roots.add(r)
    if (!roots.size) { sendable.push(e); continue }
    const list = [...roots].sort((a, b) => a - b)
    waiting.set(e.seq!, list)
    blockers.push({ entry: e, roots: list })
  }
  return { sendable, held, waiting }
}

/** What the banners say (§8, Jazz b6c71626), from the same split: the held change shown, his changes waiting on it, his changes to send. */
export function outboxCounts(queue: readonly OutboxEntry[]): { held: OutboxEntry | null; waiting: number; pending: number } {
  const plan = schedule(queue)
  const held = plan.held.find(e => !e.app) ?? null
  const his = [...plan.sendable, ...queue.filter(e => plan.waiting.has(e.seq!))].filter(e => !e.app)
  const pending = new Set(his.map(e => e.seq)).size
  const waiting = held ? new Set(queue.filter(e => !e.app && plan.waiting.get(e.seq!)?.includes(held.seq!)).map(e => e.seq)).size : 0
  return { held, waiting, pending }
}

export interface DrainResult {
  /** What the server said to each entry this drain sent, by `seq`. */
  answers: Map<number, SendAnswer>
  /** The passing failure (or owner mismatch) that stopped it, at the entry it was sending; that entry and every later one stay pending. */
  stop: { seq: number; answer: SendAnswer } | null
  /** The owner's queue as the drain last read it. */
  queue: OutboxEntry[]
}

/**
 * Sends an owner's sendable changes, oldest first, until none is left or one can't be sent (§6, §7). Run under the
 * owner's lock. The queue is read again and split again after every answer: an acknowledgement, a hold or another
 * tab's change moves what may go next (Ratchet 006210e1). `send` only talks to the server; the store is written here.
 */
export async function drainQueue(store: OutboxStore, owner: string, send: (entry: OutboxEntry) => Promise<SendAnswer>, onQueue?: (queue: OutboxEntry[]) => void): Promise<DrainResult> {
  const answers = new Map<number, SendAnswer>()
  for (;;) {
    const queue = (await store.all()).filter(e => e.owner === owner)
    onQueue?.(queue)
    const next = schedule(queue).sendable[0]
    if (!next) return { answers, stop: null, queue }
    const seq = next.seq!
    // A store that didn't record the last answer would have the drain send the same change for ever.
    if (answers.has(seq)) return { answers, stop: { seq, answer: { status: 'failed', message: 'The device did not record a sent change' } }, queue }
    const answer = await send(next)
    switch (answer.status) {
      case 'applied': await store.acknowledge(seq, owner, answer.receipt.revision); break
      case 'already-applied': await store.acknowledge(seq, owner, undefined); break
      case 'held':
        // The app's own write, no longer needed or allowed (the day was made elsewhere): dropped, unsaid.
        if (next.app) await store.remove(seq)
        else await store.update(seq, { state: 'held', held: { reason: answer.reason, ...(answer.message ? { message: answer.message } : {}), ...(answer.stale ? { stale: true as const } : {}) } })
        break
      default: return { answers, stop: { seq, answer }, queue }
    }
    answers.set(seq, answer)
  }
}

/** The banner's words for a change (Jazz §8.3): a past-tense verb and the item's name, cut at 40 characters. */
const filterFields = ['filter', 'filterAny', 'filterGroups']
/** A database's own change, named by what he sees (Jazz 0409ac87): a view by its name, a widget by its heading. */
function databaseLabel(action: Extract<Action, { type: 'change-database' }>, ws: Workspace, cut: (s: string) => string): string | null {
  const c = action.change as { kind: string; viewId?: string; widgetId?: string; fields?: Record<string, unknown> } & Record<string, unknown>
  const db = ws.pages.find(p => p.id === action.pageId)?.database
  const view = c.viewId ? db?.views.find(v => v.id === c.viewId) : undefined
  const widget = c.widgetId ? view?.dashboard?.rows.flatMap(r => r.widgets).find(w => w.id === c.widgetId) : undefined
  const source = widget ? ws.pages.find(p => p.id === widget.source) : undefined
  const heading = widget ? `"${cut(`${source?.title || 'To-dos'} · ${widget.view.name}`)}"` : null
  const named = view ? `"${cut(view.name)}"` : null
  switch (c.kind) {
    case 'setDashboardFilter': return named && `filtered ${named}`
    case 'updateWidget': return heading && (Object.keys(c.fields ?? {}).some(f => filterFields.includes(f)) ? `filtered ${heading}` : `changed ${heading}`)
    case 'moveWidget': case 'swapWidget': return heading && `moved ${heading}`
    case 'removeWidget': return heading && `deleted ${heading}`
    case 'updateView': return named && (Object.keys(c).some(f => filterFields.includes(f)) ? `filtered ${named}` : `changed ${named}`)
    default: return null
  }
}

export function labelFor(action: Action, ws: Workspace): string {
  const cut = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s)
  const page = (id: string | undefined) => (id ? ws.pages.find(p => p.id === id) : undefined)
  const task = (id: string | undefined) => (id ? ws.tasks.find(t => t.id === id) : undefined)
  const a = action as Action & { taskId?: string; pageId?: string; title?: string; status?: string; rowId?: string }
  const name = task(a.taskId)?.title || page(a.rowId ?? a.pageId)?.title || a.title
  const quoted = name ? `"${cut(name)}"` : null
  if (action.type === 'change-database') { const said = databaseLabel(action, ws, cut); if (said) return said }
  if (action.type === 'set-values') {
    // A cell: `set <Property> on "<row>"` (Jazz §8.3, 3d66a938); the row alone once its property is gone.
    const row = page(action.pageId), db = row?.parentId ? page(row.parentId)?.database : undefined
    const names = Object.keys(action.values).map(k => (k === 'title' ? 'Name' : db?.properties.find(p => p.id === k)?.name)).filter((x): x is string => Boolean(x))
    const where = row ? `"${cut(row.title || 'Untitled')}"` : null
    if (where && names.length === 1) return `set ${names[0]} on ${where}`
    if (where && names.length > 1) return `set ${names.length} values on ${where}`
  }
  switch (action.type) {
    case 'task-status': return quoted ? `${a.status === 'done' ? 'ticked' : a.status === 'open' ? 'unticked' : 'changed'} ${quoted}` : 'a change'
    case 'add-task': case 'add-row': case 'add-rows': return quoted ? `added ${quoted}` : 'added a row'
    case 'rename-task': case 'rename-page': return quoted ? `renamed ${quoted}` : 'a rename'
    case 'move-row': case 'move-page': return quoted ? `moved ${quoted}` : 'a move'
    case 'delete-page': case 'delete-pages': case 'remove-task-row': return quoted ? `deleted ${quoted}` : 'a delete'
    case 'run-button': case 'run-row-button': return quoted ? `ran ${quoted}` : 'ran a button'
    case 'undo': return 'an Undo'
    // The row's Another day (#377): named by its to-do, so the banner's Keep mine / Discard says which one.
    case 'move-draft': { const t = task(draftOf(ws, action.pageId)?.items.find(i => i.id === action.itemId)?.taskId); return t ? `moved "${cut(t.title)}"` : 'a move' }
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

/**
 * After Delete account answers (B98 §7, Ratchet 241fda62): when it went through, the account's stored changes leave the
 * device first, then its offline copy and caches; a refused deletion keeps them. True when the account is gone.
 */
export async function afterDeletion(ok: boolean, steps: { clearOutbox(): Promise<void>; clearOfflineData(): Promise<void> }): Promise<boolean> {
  if (!ok) return false
  await steps.clearOutbox()
  await steps.clearOfflineData()
  return true
}
