import type { LocalDate, Page, Workspace } from "./types";

// pages-delta N-2 / N-5 step B: the page tree and "Linked from". The tree is each page's own parentId; sibling order
// is the workspace's page order, so a page that is created or moved lands at the end of its new siblings.

/** The parent a page actually sits under: a missing parent (or a day page, which has none) reads as top level. */
export function parentOf(ws: Workspace, p: Page): Page | null {
  if (p.type === "daily" || !p.parentId) return null;
  return ws.pages.find((x) => x.id === p.parentId) ?? null;
}

/** Children in sibling order. `null` lists the top-level document pages; day pages live in the Days group instead. */
export function childPages(ws: Workspace, parentId: string | null): Page[] {
  return ws.pages.filter((p) => p.type === "document" && (parentOf(ws, p)?.id ?? null) === parentId);
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
  if (parentId !== null && !ws.pages.some((x) => x.id === parentId)) return "Page not found";
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
}

/**
 * N-5: pages with a real reference to this page (a page card, a `/page` subpage card), one entry per page, day pages
 * newest date first, then document pages newest first by workspace order. Being the parent adds nothing by itself,
 * so moving either page never changes this list. A page's references to itself are not listed.
 */
export function linkedFrom(ws: Workspace, pageId: string): LinkedFromEntry[] {
  const target = ws.pages.find((p) => p.id === pageId);
  if (!target) return [];
  const parentId = parentOf(ws, target)?.id;
  const sources = ws.pages.filter(
    (p) => p.id !== pageId && p.sections.some((s) => s.blocks.some((b) => b.kind === "reference" && b.targetPageId === pageId)),
  );
  const days = sources.filter((p) => p.type === "daily").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const documents = sources.filter((p) => p.type !== "daily").reverse();
  return [...days, ...documents].map((page) => ({ page, isParent: page.id === parentId }));
}

/** Something was written or tracked on the page; a page created by opening or browsing a day has neither. */
function hasContent(page: Page): boolean {
  return Boolean(page.reviewText.trim()) || page.sections.some((s) => s.blocks.some((b) => b.kind === "task" || b.text.trim()));
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
