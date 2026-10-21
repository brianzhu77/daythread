import type { LocalDate, Page, Workspace } from "./types";
import { refHolders } from "./page-refs.ts";

// pages-delta N-2 / N-5 step B: the page tree and "Linked from". The tree is each page's own parentId; sibling order
// is the workspace's page order, so a page that is created or moved lands at the end of its new siblings.

/** A4: a page in the trash. Day pages can't be deleted, so they're always live. */
export function isTrashed(p: Page): boolean {
  return Boolean(p.trashedAt);
}

/**
 * A4 (Lead fd179341): the one way lists read pages. Trashed pages leave every list and count; only a card pointing at
 * one and the Trash screen still show it, and those look it up by id.
 */
export function visiblePages(ws: Workspace): Page[] {
  return ws.pages.filter((p) => !isTrashed(p));
}

/** The parent a page actually sits under: a missing parent (or a day page, which has none) reads as top level. */
export function parentOf(ws: Workspace, p: Page): Page | null {
  if (p.type === "daily" || !p.parentId) return null;
  return ws.pages.find((x) => x.id === p.parentId) ?? null;
}

/** Children in sibling order. `null` lists the top-level document pages; day pages live in the Days group instead. */
export function childPages(ws: Workspace, parentId: string | null): Page[] {
  return visiblePages(ws).filter((p) => p.type === "document" && (parentOf(ws, p)?.id ?? null) === parentId);
}

/** The Subpages of a trashed page: its children deleted with it (pages-trash-layout §4). */
export function trashedChildPages(ws: Workspace, page: Page): Page[] {
  return ws.pages.filter((p) => isTrashed(p) && p.trashId === page.trashId && p.parentId === page.id);
}

/** A delete's members still in the trash, in stored order; the batch's top page is the one whose parent isn't a member. */
export function trashBatch(ws: Workspace, trashId: string): { top: Page; members: Page[] } | null {
  const members = ws.pages.filter((p) => isTrashed(p) && p.trashId === trashId);
  const ids = new Set(members.map((p) => p.id));
  const top = members.find((p) => !p.parentId || !ids.has(p.parentId));
  return top ? { top, members } : null;
}

/** The Trash screen: one row per delete with members left, newest delete first. */
export function trashBatches(ws: Workspace): { trashId: string; top: Page; members: Page[]; trashedAt: string }[] {
  const ids = [...new Set(ws.pages.filter(isTrashed).map((p) => p.trashId!))];
  return ids
    .map((trashId) => ({ trashId, ...trashBatch(ws, trashId)! }))
    .map((b) => ({ ...b, trashedAt: b.top.trashedAt! }))
    .sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

/** Root first, the page itself excluded: the breadcrumb. Stops at a cycle, which only corrupt data can contain. */
export function pageAncestors(ws: Workspace, pageId: string): Page[] {
  const chain: Page[] = [], seen = new Set([pageId]);
  let current = ws.pages.find((p) => p.id === pageId);
  while (current) {
    const parent = parentOf(ws, current);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** The page and everything under it, at any depth. */
export function subtreeIds(ws: Workspace, pageId: string): Set<string> {
  const ids = new Set([pageId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of ws.pages) {
      const parent = parentOf(ws, p);
      if (parent && ids.has(parent.id) && !ids.has(p.id)) { ids.add(p.id); grew = true; }
    }
  }
  return ids;
}

/** Why a move is refused, or null when it's allowed. `parentId` null = top level. */
export function moveRefusal(ws: Workspace, pageId: string, parentId: string | null): string | null {
  const p = ws.pages.find((x) => x.id === pageId);
  if (!p) return "Page not found";
  if (p.type === "daily") return "Day pages stay in Days";
  if (isTrashed(p)) return "Page is in trash";
  const target = parentId === null ? null : ws.pages.find((x) => x.id === parentId);
  if (parentId !== null && !target) return "Page not found";
  if (target && isTrashed(target)) return "Page is in trash";
  if (parentId !== null && subtreeIds(ws, pageId).has(parentId)) return "Can't move a page into itself or its subpages";
  if ((parentOf(ws, p)?.id ?? null) === parentId) return "Already there";
  return null;
}

/** Every page that can take this page as a child, for Move to…: not the page, its subpages or its current parent. */
export function moveTargets(ws: Workspace, pageId: string): Page[] {
  return ws.pages.filter((x) => moveRefusal(ws, pageId, x.id) === null);
}

export interface LinkedFromEntry {
  page: Page;
  /** The referencing page is also this page's current parent (its card is a real reference; the tree link isn't). */
  isParent: boolean;
  /** A4: the referencing page is in the trash; it reads "{title} (removed)" and doesn't open. */
  removed: boolean;
}

/** One reference to a page, wherever it lives: a card (block) or a `[[` link (block + refId). */
export interface PageReference { sourceId: string; key: string; at: number | undefined }
/**
 * Every live reference to `pageId` from other pages: cards and `[[` links (A9a), on live and trashed pages. A link
 * counts as soon as its page exists, pending or not (plan §4).
 */
export function referencesTo(ws: Workspace, pageId: string): PageReference[] {
  if (!ws.pages.some((p) => p.id === pageId)) return []
  return ws.pages.flatMap((p) => p.id === pageId ? [] : [
    ...p.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "reference" && b.targetPageId === pageId).map((b): PageReference => ({ sourceId: p.id, key: `${p.id}/${b.id}`, at: b.at }))),
    ...refHolders(p).flatMap((h) => h.refs.filter((r) => r.pageId === pageId).map((r): PageReference => ({ sourceId: p.id, key: `${p.id}/${h.id}/${r.refId}`, at: r.at }))),
  ])
}
/**
 * N-5 + B15: pages with a real reference to this page (a card or a `[[` link), one entry per page, newest first by
 * that page's newest live reference here (plan a9-page-links §2). Being the parent adds nothing by itself, and a move
 * never changes the order. References not stamped yet (only between an old-build save and the re-upgrade) come last,
 * in the old order. A page's references to itself are not listed.
 */
export function linkedFrom(ws: Workspace, pageId: string): LinkedFromEntry[] {
  const target = ws.pages.find((p) => p.id === pageId);
  if (!target) return [];
  const parentId = parentOf(ws, target)?.id;
  const newest = new Map<string, number | undefined>();
  for (const r of referencesTo(ws, pageId)) {
    const had = newest.get(r.sourceId);
    newest.set(r.sourceId, r.at === undefined ? had : had === undefined ? r.at : Math.max(had, r.at));
  }
  const sources = ws.pages.filter((p) => newest.has(p.id));
  const untimed = sources.filter((p) => newest.get(p.id) === undefined);
  const legacy = [...untimed.filter((p) => p.type === "daily").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), ...untimed.filter((p) => p.type !== "daily").reverse()];
  const timed = sources.filter((p) => newest.get(p.id) !== undefined).sort((a, b) => newest.get(b.id)! - newest.get(a.id)!);
  return [...timed, ...legacy].map((page) => ({ page, isParent: page.id === parentId, removed: isTrashed(page) }));
}

/**
 * A9a §3: the empty `[[` list, the same on every device: pages by the newest time of any reference to them, then pages
 * with none (days newest first, then the rest in stored order). Never the current page or a trashed one.
 */
export function recentPages(ws: Workspace, currentId: string | null): Page[] {
  const newest = new Map<string, number>();
  for (const p of ws.pages) {
    const hits: [string, number | undefined][] = [
      ...p.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "reference" && b.targetPageId).map((b) => [b.targetPageId!, b.at] as [string, number | undefined])),
      ...refHolders(p).flatMap((h) => h.refs.map((r) => [r.pageId, r.at] as [string, number])),
    ];
    for (const [id, at] of hits) if (at !== undefined) newest.set(id, Math.max(newest.get(id) ?? -Infinity, at));
  }
  const live = visiblePages(ws).filter((p) => p.id !== currentId);
  const timed = live.filter((p) => newest.has(p.id)).sort((a, b) => newest.get(b.id)! - newest.get(a.id)!);
  const rest = live.filter((p) => !newest.has(p.id));
  return [...timed, ...rest.filter((p) => p.type === "daily").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), ...rest.filter((p) => p.type !== "daily")];
}

/**
 * v0.3 §6.2 "title, short preview" (Brian's UI comparison, Lead a2edc0a7): the first lines he wrote on a page, joined
 * with " · ", for the line under a page card. Headings and other pages' cards are left out; empty when nothing is written.
 */
export function pagePreview(p: Page, lines = 2, max = 120): string {
  const texts = p.sections.flatMap((s) => s.blocks).filter((b) => b.kind !== "reference" && b.text.trim()).slice(0, lines).map((b) => b.text.trim().replace(/\s+/g, " "));
  const joined = texts.join(" · ");
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

/** Something was written or tracked on the page; a page created by opening or browsing a day has neither. */
function hasContent(page: Page): boolean {
  return Boolean(page.reviewText.trim()) || page.sections.some((s) => s.blocks.some((b) => b.kind === "task" || b.text.trim()));
}

/** Days with something written or with subpages, as the sidebar lists them: the header picker's dots. */
export function writtenDays(ws: Workspace): Set<string> {
  return new Set(ws.pages.filter((p) => p.type === "daily" && p.date && !p.trashedAt && (hasContent(p) || childPages(ws, p.id).length > 0)).map((p) => p.date!))
}

/**
 * The sidebar's Days group (layout §1), newest first: this month's days (today always) plus future days, then earlier
 * months by month. A past day is listed when it has content or subpages. A future day is listed only when it has
 * subpages or holds the open page (Lead 4eac80fd), so a page moved under it stays reachable from the tree; future days
 * are otherwise still opened from the Calendar.
 */
export function sidebarDays(ws: Workspace, today: LocalDate, activeId: string | null): { recent: Page[]; earlier: Map<string, Page[]> } {
  const active = new Set(activeId ? [activeId, ...pageAncestors(ws, activeId).map((p) => p.id)] : []);
  const listed = (p: Page) =>
    p.date === today || active.has(p.id) || childPages(ws, p.id).length > 0 || (p.date! < today && hasContent(p));
  const days = ws.pages.filter((p) => p.type === "daily" && p.date && listed(p)).sort((a, b) => b.date!.localeCompare(a.date!));
  const month = today.slice(0, 7);
  const recent = days.filter((p) => p.date! >= today || p.date!.startsWith(month));
  const earlier = new Map<string, Page[]>();
  for (const p of days) if (!recent.includes(p)) earlier.set(p.date!.slice(0, 7), [...(earlier.get(p.date!.slice(0, 7)) ?? []), p]);
  return { recent, earlier };
}

/**
 * Pages made inside day pages (`/page` on a day, the main way pages are made), grouped by day, newest day first; each
 * day's direct subpages in sibling order. The Pages screen lists them under "In your days" (Lead 02cbc559), so a page
 * whose parent is a day is never missing from Pages. Deeper pages are reached through their Subpages.
 */
export function pagesInDays(ws: Workspace): { day: Page; pages: Page[] }[] {
  return ws.pages
    .filter((p) => p.type === "daily" && p.date)
    .sort((a, b) => b.date!.localeCompare(a.date!))
    .map((day) => ({ day, pages: childPages(ws, day.id) }))
    .filter((g) => g.pages.length > 0);
}
