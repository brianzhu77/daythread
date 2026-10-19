import type { Page, Workspace } from "./types";

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
