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
 * A closed tab's draft without what the page already has (Lead 62bf2071): a line whose words are on the page under
 * the same id, give or take whitespace, counts as unchanged; an empty line adds nothing. So a draft whose save went
 * through (its reply lost) merges in nothing, and nothing appears twice.
 */
export function withoutSaved<N extends { id: string; content?: unknown; children?: N[] }>(draft: N[], latest: N[], text: (content: unknown) => string): N[] {
  const onPage = new Map<string, N>()
  const remember = (n: N) => { onPage.set(n.id, n); n.children?.forEach(remember) }
  latest.forEach(remember)
  const words = (n: N) => text(n.content).replace(/\s+/g, ' ').trim()
  const clean = (list: N[]): N[] => list.flatMap(n => {
    const children = clean(n.children ?? [])
    const there = onPage.get(n.id)
    if (there && words(there) === words(n)) return [{ ...there, children: there.children } as N]
    if (!there && !words(n) && !children.length) return []
    return [{ ...n, children } as N]
  })
  return clean(draft)
}
