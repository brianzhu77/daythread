import type { LocalDate, Page, Workspace } from "./types.ts";
import { flatNodes, inlineText, isTaskRow, pageNodes, textDate, type EditorNode } from "./editor-document.ts";
import { refHolders, refTargetPage } from "./page-refs.ts";

// The page tree is each page's own parentId; sibling order is the workspace's page order. "Linked from" reads the
// documents: cards (pageLink blocks) and `[[` links, each stamped with the revision of the save that first held it.

export function isTrashed(p: Page): boolean {
  return Boolean(p.trashedAt);
}
export function visiblePages(ws: Workspace): Page[] {
  return ws.pages.filter((p) => !isTrashed(p));
}
export function parentOf(ws: Workspace, p: Page): Page | null {
  if (p.type === "daily" || !p.parentId) return null;
  return ws.pages.find((x) => x.id === p.parentId) ?? null;
}
export function childPages(ws: Workspace, parentId: string | null): Page[] {
  return visiblePages(ws).filter((p) => p.type === "document" && (parentOf(ws, p)?.id ?? null) === parentId);
}
export function trashedChildPages(ws: Workspace, page: Page): Page[] {
  return ws.pages.filter((p) => isTrashed(p) && p.trashId === page.trashId && p.parentId === page.id);
}
export function trashBatch(ws: Workspace, trashId: string): { top: Page; members: Page[] } | null {
  const members = ws.pages.filter((p) => isTrashed(p) && p.trashId === trashId);
  const ids = new Set(members.map((p) => p.id));
  const top = members.find((p) => !p.parentId || !ids.has(p.parentId));
  return top ? { top, members } : null;
}
export function trashBatches(ws: Workspace): { trashId: string; top: Page; members: Page[]; trashedAt: string }[] {
  const ids = [...new Set(ws.pages.filter(isTrashed).map((p) => p.trashId!))];
  return ids.map((trashId) => ({ trashId, ...trashBatch(ws, trashId)! })).map((b) => ({ ...b, trashedAt: b.top.trashedAt! })).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}
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
export function moveTargets(ws: Workspace, pageId: string): Page[] {
  return ws.pages.filter((x) => moveRefusal(ws, pageId, x.id) === null);
}

export interface LinkedFromEntry { page: Page; isParent: boolean; removed: boolean }
export interface PageReference { sourceId: string; key: string; at: number | undefined }
/** Every reference to `pageId` from other pages: cards and `[[` links, on live and trashed pages. */
export function referencesTo(ws: Workspace, pageId: string): PageReference[] {
  if (!ws.pages.some((p) => p.id === pageId)) return [];
  return ws.pages.flatMap((p) => p.id === pageId ? [] : [
    ...flatNodes(pageNodes(p)).filter((n) => n.type === "pageLink" && n.props?.pageId === pageId).map((n): PageReference => ({ sourceId: p.id, key: `${p.id}/${n.id}`, at: typeof n.props?.at === "number" ? n.props.at : undefined })),
    ...refHolders(p).flatMap((h) => h.refs.filter((r) => refTargetPage(ws, r) === pageId).map((r): PageReference => ({ sourceId: p.id, key: `${p.id}/${h.id}/${r.refId}`, at: r.at }))),
  ]);
}
/** Pages with a reference to this page, one entry per page, newest reference first; the parent only when it really refers. */
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
/** The empty `[[` list: pages by the newest reference to them, then days newest first, then the rest. */
export function recentPages(ws: Workspace, currentId: string | null): Page[] {
  const newest = new Map<string, number>();
  for (const p of ws.pages) {
    const hits: [string, number | undefined][] = [
      ...flatNodes(pageNodes(p)).filter((n) => n.type === "pageLink" && typeof n.props?.pageId === "string").map((n) => [String(n.props!.pageId), typeof n.props?.at === "number" ? n.props.at : undefined] as [string, number | undefined]),
      ...refHolders(p).flatMap((h) => h.refs.map((r) => [refTargetPage(ws, r), r.at] as [string, number | undefined])),
    ];
    for (const [id, at] of hits) if (at !== undefined) newest.set(id, Math.max(newest.get(id) ?? -Infinity, at));
  }
  const live = visiblePages(ws).filter((p) => p.id !== currentId);
  const timed = live.filter((p) => newest.has(p.id)).sort((a, b) => newest.get(b.id)! - newest.get(a.id)!);
  const rest = live.filter((p) => !newest.has(p.id));
  return [...timed, ...rest.filter((p) => p.type === "daily").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), ...rest.filter((p) => p.type !== "daily")];
}
/** The card on `parent` that points at `pageId`, if any. */
export function cardTo(parent: Page, pageId: string): EditorNode | undefined {
  return flatNodes(pageNodes(parent)).find((n) => n.type === "pageLink" && n.props?.pageId === pageId);
}
/** The first lines written on a page, joined with " · ", for the line under a page card. Headings and cards are left out. */
export function pagePreview(p: Page, lines = 2, max = 120): string {
  const texts = flatNodes(pageNodes(p)).filter((n) => n.type !== "heading" && n.type !== "pageLink").map((n) => inlineText(n.content, textDate(p)).trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, lines);
  const joined = texts.join(" · ");
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}
/** Something was written on the page: a to-do row with a task, or a line with words. */
export function hasContent(page: Page): boolean {
  return flatNodes(pageNodes(page)).some((n) => (isTaskRow(n) && !String(n.props!.taskId).startsWith("editor-task:")) || (n.type !== "heading" && inlineText(n.content, textDate(page)).trim() !== ""));
}
export function writtenDays(ws: Workspace): Set<string> {
  return new Set(ws.pages.filter((p) => p.type === "daily" && p.date && !p.trashedAt && (hasContent(p) || childPages(ws, p.id).length > 0)).map((p) => p.date!));
}
/**
 * The sidebar's Days group, newest first: this month's days (today always) plus future days, then earlier months by
 * month. A past day is listed when it has content or subpages; a future day only with subpages or when it holds the open page.
 */
export function sidebarDays(ws: Workspace, today: LocalDate, activeId: string | null): { recent: Page[]; earlier: Map<string, Page[]> } {
  const month = today.slice(0, 7);
  const days = ws.pages.filter((p) => p.type === "daily" && p.date && !p.trashedAt).sort((a, b) => b.date!.localeCompare(a.date!));
  const listed = days.filter((p) => p.date === today || (p.date! < today ? hasContent(p) || childPages(ws, p.id).length > 0 : childPages(ws, p.id).length > 0 || p.id === activeId));
  const recent = listed.filter((p) => p.date!.slice(0, 7) >= month);
  const earlier = new Map<string, Page[]>();
  for (const p of listed.filter((p) => p.date!.slice(0, 7) < month)) { const key = p.date!.slice(0, 7); earlier.set(key, [...(earlier.get(key) ?? []), p]); }
  return { recent, earlier };
}
/** Pages made inside day pages, grouped by day, newest day first. */
export function pagesInDays(ws: Workspace): { day: Page; pages: Page[] }[] {
  const days = ws.pages.filter((p) => p.type === "daily" && p.date && !p.trashedAt).sort((a, b) => b.date!.localeCompare(a.date!));
  return days.map((day) => ({ day, pages: childPages(ws, day.id) })).filter((g) => g.pages.length > 0);
}
