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
/** A slot nobody has touched for this long is a tab that's gone (background tabs refresh about once a minute). */
export const goneAfterMs = 2 * 60_000
/** Browser checks shorten the wait (set before the page loads); the app never sets it. */
const goneAfter = () => (globalThis as { __daythreadGoneAfterMs?: number }).__daythreadGoneAfterMs ?? goneAfterMs

/** This tab's id, kept across reloads of the same tab (sessionStorage is per tab). */
export function tabId(): string {
  try {
    const existing = sessionStorage.getItem('daythread.tab')
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem('daythread.tab', id)
    return id
  } catch {
    return 'tab'
  }
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
