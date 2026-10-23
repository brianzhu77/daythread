/**
 * B35 part 2: unsaved editor text is kept per tab, not per page. Two tabs on one page used to share one localStorage
 * slot, so the second overwrote the first and only one draft came back (Ratchet 155). Now each tab writes
 * `daythread:editor:<page>:<tab>`; a tab that's gone (closed, or not seen for a while) leaves a slot that the next tab
 * to open the page merges in and then claims. A tab that comes back after its slot was claimed (an iOS tab suspended,
 * then resumed) sees the claim, drops its copy and loads the latest, so his lines are never saved twice (Lead
 * 0f0d…/"phone tab that iOS suspended").
 */
export interface DraftSlot {
  base: string
  document: string
  cutTaskIds?: string[]
  /** Last time the tab that owns it was alive (ms). */
  seen: number
  /** Set when the tab closed (pagehide). */
  closed?: boolean
  /** Set by the tab that merged this slot; the owner, if it comes back, must not save its copy. */
  claimedBy?: string
}

const prefix = (pageId: string) => `daythread:editor:${pageId}`
/**
 * A slot nobody has touched for this long is a tab that's gone. Closed tabs say so at once (pagehide); this only
 * covers tabs killed without it. Chrome slows a long-hidden tab's timers to about once a minute, so the cutoff sits
 * well above that: a live background tab is never taken over (Bumblebee 591734ff).
 */
export const goneAfterMs = 10 * 60_000
/** Browser checks shorten the wait (set before the page loads); the app never sets it. */
const goneAfter = () => (globalThis as { __daythreadGoneAfterMs?: number }).__daythreadGoneAfterMs ?? goneAfterMs

/**
 * This tab's id, kept across reloads of the same tab (sessionStorage is per tab). A tab opened from another one (a
 * ⌘-click, a link with an opener, "Duplicate tab") starts with a copy of that tab's sessionStorage, id included
 * (Ratchet 66accf58, Bumblebee 5ab67ef1): each page load records that it owns its id, and a load that finds the id
 * owned by another live load takes a new one. A reload releases its record on pagehide, so it keeps its id.
 */
const instance = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())
let resolvedTab: string | null = null
const ownerKey = (id: string) => `daythread:tab-owner:${id}`
export function tabId(): string {
  if (resolvedTab) return resolvedTab
  try {
    let id = sessionStorage.getItem('daythread.tab')
    const owner = id ? (JSON.parse(localStorage.getItem(ownerKey(id)) ?? 'null') as { instance?: string; seen?: number } | null) : null
    if (!id || (owner && owner.instance !== instance && Date.now() - (owner.seen ?? 0) < goneAfter())) {
      id = crypto.randomUUID()
      sessionStorage.setItem('daythread.tab', id)
    }
    localStorage.setItem(ownerKey(id), JSON.stringify({ instance, seen: Date.now() }))
    return resolvedTab = id
  } catch {
    return resolvedTab = 'tab'
  }
}
/** Keeps this load's claim on its tab id fresh; released when the tab goes (so a reload keeps the id). */
export function touchTab(release = false): void {
  try {
    const id = tabId()
    if (release) localStorage.removeItem(ownerKey(id))
    else localStorage.setItem(ownerKey(id), JSON.stringify({ instance, seen: Date.now() }))
  } catch { /* storage unavailable */ }
}

const parse = (raw: string | null): DraftSlot | null => {
  try {
    const value = JSON.parse(raw ?? 'null')
    return value && typeof value.document === 'string' && typeof value.base === 'string' ? value as DraftSlot : null
  } catch {
    return null
  }
}

export function ownKey(pageId: string, tab = tabId()): string {
  return `${prefix(pageId)}:${tab}`
}

/** This tab's slot (or, once, the old one-slot key from before per-tab slots). */
export function readOwn(pageId: string): DraftSlot | null {
  const own = parse(localStorage.getItem(ownKey(pageId)))
  return own && !own.claimedBy ? own : null
}

/** True when another tab merged this tab's draft while it was away. */
export function ownClaimed(pageId: string): boolean {
  return Boolean(parse(localStorage.getItem(ownKey(pageId)))?.claimedBy)
}

export function writeOwn(pageId: string, slot: Omit<DraftSlot, 'seen'>): void {
  localStorage.setItem(ownKey(pageId), JSON.stringify({ ...slot, seen: Date.now() }))
}

/** Clears this tab's slot; with `document`, only if it still holds exactly that text. */
export function clearOwn(pageId: string, document?: string): void {
  try {
    const key = ownKey(pageId)
    if (document === undefined || parse(localStorage.getItem(key))?.document === document) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

/** Keeps this tab's slot marked alive; `closed` when the tab goes away. */
export function touchOwn(pageId: string, closed = false): void {
  try {
    const key = ownKey(pageId), slot = parse(localStorage.getItem(key))
    if (slot && !slot.claimedBy) localStorage.setItem(key, JSON.stringify({ ...slot, seen: Date.now(), ...(closed ? { closed: true } : {}) }))
  } catch { /* storage unavailable */ }
}

/** Drafts other tabs left behind on this page: closed, or not seen for `goneAfterMs`, and not yet claimed. */
export function orphans(pageId: string, now = Date.now()): { key: string; slot: DraftSlot }[] {
  const out: { key: string; slot: DraftSlot }[] = []
  const own = ownKey(pageId), legacy = prefix(pageId)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || key === own || !(key === legacy || key.startsWith(`${legacy}:`))) continue
    const slot = parse(localStorage.getItem(key))
    if (!slot || slot.claimedBy) continue
    // The old one-slot key had no owner or time: it belongs to whichever tab opens the page next.
    if (key === legacy || slot.closed || now - (slot.seen ?? 0) > goneAfter()) out.push({ key, slot })
  }
  return out.sort((a, b) => (a.slot.seen ?? 0) - (b.slot.seen ?? 0))
}

/** Marks a merged slot as claimed (the old one-slot key is simply removed). Claims are cleared after a day. */
export function claim(pageId: string, key: string): void {
  try {
    if (key === prefix(pageId)) { localStorage.removeItem(key); return }
    const slot = parse(localStorage.getItem(key))
    if (slot) localStorage.setItem(key, JSON.stringify({ ...slot, document: '', claimedBy: tabId(), seen: Date.now() }))
  } catch { /* storage unavailable */ }
}

/** Removes this tab's claim marker once it has acted on it, and old claims left by tabs that never came back. */
export function sweepClaims(pageId: string, now = Date.now()): void {
  try {
    const own = ownKey(pageId), legacy = prefix(pageId), stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(`${legacy}:`)) continue
      const slot = parse(localStorage.getItem(key))
      if (slot?.claimedBy && (key === own || now - slot.seen > 24 * 60 * 60_000)) stale.push(key)
    }
    stale.forEach(key => localStorage.removeItem(key))
  } catch { /* storage unavailable */ }
}

/**
 * B35 part 3: whether a change came from another tab of this browser or from another device. Each tab announces its
 * saves; a conflict on a page another tab here saved in the last few minutes is "another tab", anything else "another
 * device" (Brian's phone and Mac share the page).
 */
const otherTabSaves = new Map<string, number>()
let channel: BroadcastChannel | null = null
function saves(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel('daythread-saves')
  channel.onmessage = (e: MessageEvent<{ pageId?: string; tab?: string }>) => {
    if (e.data?.pageId && e.data.tab !== tabId()) otherTabSaves.set(e.data.pageId, Date.now())
  }
  return channel
}
/** Starts listening (call once when a page editor opens). */
export function listenForSaves(): void { saves() }
export function announceSave(pageId: string): void {
  try { saves()?.postMessage({ pageId, tab: tabId() }) } catch { /* no channel: conflicts read as another device */ }
}
export function changedBy(pageId: string, now = Date.now()): 'tab' | 'device' {
  const at = otherTabSaves.get(pageId)
  return at !== undefined && now - at < 5 * 60_000 ? 'tab' : 'device'
}

/**
 * A closed tab's draft without what the page already has (Lead 62bf2071, 0ce16749): a line counts as unchanged only
 * under the same block id, with the same kind, props and inline content, give or take whitespace in its text (a save
 * whose reply was lost). Its own children are still checked one by one, so an unsaved child under an unchanged parent
 * stays (Ratchet 2b858bf3). A new line with no content and no children adds nothing. Matching words alone never drops
 * a line: a second "Call mom" typed on purpose is a different block.
 */
type DraftNode = { id: string; type?: string; props?: unknown; content?: unknown; children?: DraftNode[] }
const space = (text: string) => text.replace(/\s+/g, ' ')
/** Inline content with whitespace runs collapsed and the line's ends trimmed; empty text runs dropped. */
function normalContent(content: unknown): unknown {
  // A string is the editor's shorthand for one unstyled text run.
  if (typeof content === 'string') content = [{ type: 'text', text: content, styles: {} }]
  if (!Array.isArray(content)) return content ?? null
  const runs = content.map(c => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? { ...c, text: space(String((c as { text?: unknown }).text ?? '')) } : c))
  const first = runs[0] as { type?: string; text?: string } | undefined, last = runs.at(-1) as typeof first
  if (first?.type === 'text') runs[0] = { ...first, text: first.text!.trimStart() }
  if (last?.type === 'text') runs[runs.length - 1] = { ...runs.at(-1) as object, text: (runs.at(-1) as { text: string }).text.trimEnd() }
  return runs.filter(c => !(c && typeof c === 'object' && (c as { type?: string }).type === 'text' && !(c as { text?: string }).text))
}
/** JSON with object keys sorted, so the same props read back from the server compare equal. */
const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v))
const line = (n: DraftNode) => stable([n.type ?? null, n.props ?? {}, normalContent(n.content)])
const blank = (n: DraftNode) => {
  const c = normalContent(n.content)
  return (c === null || (Array.isArray(c) && !c.length)) && (n.type === undefined || ['paragraph', 'bulletListItem', 'numberedListItem', 'checkListItem', 'task'].includes(n.type))
}
export function withoutSaved<N extends DraftNode>(draft: N[], latest: N[]): N[] {
  const onPage = new Map<string, DraftNode>()
  const remember = (n: DraftNode) => { onPage.set(n.id, n); n.children?.forEach(remember) }
  latest.forEach(remember)
  const clean = (list: DraftNode[]): DraftNode[] => list.flatMap(n => {
    const children = clean(n.children ?? [])
    const there = onPage.get(n.id)
    // The page's own copy of the line (its exact whitespace), with the draft's children.
    if (there && line(there) === line(n)) return [{ ...there, children }]
    if (!there && blank(n) && !children.length) return []
    return [{ ...n, children }]
  })
  return clean(draft) as N[]
}
