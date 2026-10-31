// The domain: commands over the workspace (pure, one at a time, with receipts for replay and one Undo slot) and the
// views every screen reads. Pages and tasks are stored; what a page says about its tasks is read from its document.
import { emptyLine, emptyTaskRow, flatNodes, inlineText, isEmptyLine, isTaskRow, pageContentKey, pageNodes, rowInsertIndex, rowRole, rowTaskId, sectionInsertIndex, templateDocument, textDate, textRun, type EditorNode } from "./editor-document.ts";
import { dayEvents } from "./chip-events.ts";
import { builtInDayNodes, dayPagesTarget, daySubpagesTarget, dayTemplateTitle, defaultTemplate, isTemplate, pageFromTemplate, subpageTemplate, templateRows } from "./day-template.ts";
import { isTrashed, moveRefusal, subtreeIds } from "./page-tree.ts";
import { defaultLinkTitle, urlKey } from "./url-key.ts";
import type { Action, Command, CommandResult, DayView, Page, Task, Workspace } from "./types.ts";

export class DomainError extends Error {}
export function createEmptyWorkspace(timezone = "America/Vancouver"): Workspace {
  return { schemaVersion: 2, revision: 0, timezone: validTimezone(timezone), pages: [], tasks: [], deletedTasks: [], receipts: {} };
}
/** An IANA time zone name the runtime knows; anything else is refused. */
export function validTimezone(value: string): string {
  if (typeof value !== "string" || !value || value.length > 100) throw new DomainError("Unknown time zone");
  try { new Intl.DateTimeFormat("en-CA", { timeZone: value }); } catch { throw new DomainError("Unknown time zone"); }
  return value;
}
/** Tombstones kept for ⌘Z (B33): newest last. */
export const tombstoneLimit = 100;

const newId = (): string => crypto.randomUUID();
function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new DomainError("Invalid calendar date");
  return value;
}
/** Text as typed, except U+0000, which no text column can hold (Postgres refuses it) and no keyboard produces. */
function text(value: string, limit = 100_000): string {
  if (typeof value !== "string" || value.length > limit) throw new DomainError("Text exceeds limit");
  return value.replace(/\u0000/g, "");
}
/** The same for the text runs of a document's nodes, in place. */
function cleanRuns(nodes: EditorNode[]): void {
  for (const n of flatNodes(nodes)) if (Array.isArray(n.content)) for (const c of n.content as { type?: string; text?: string }[]) if (c && typeof c.text === "string" && c.text.includes("\u0000")) c.text = c.text.replace(/\u0000/g, "");
}
export function addDays(value: string, days: number): string {
  const d = new Date(`${date(value)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function page(state: Workspace, id: string): Page {
  const p = state.pages.find((x) => x.id === id);
  if (!p) throw new DomainError("Page not found");
  return p;
}
/** A page the command may change as a page: never the day template, which only its own editor and Reset change. */
function ordinaryPage(state: Workspace, id: string): Page {
  const p = page(state, id);
  if (isTemplate(p)) throw new DomainError("The day template can't be changed that way");
  return p;
}
function task(state: Workspace, id: string): Task {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) throw new DomainError("Task not found");
  return t;
}
const dayPage = (state: Workspace, day: string): Page | undefined => state.pages.find((p) => p.type === "daily" && p.date === day);
// A template's rows are never a task's place (B70): only live, ordinary pages hold tasks.
const livePages = (state: Workspace): Page[] => state.pages.filter((p) => !isTrashed(p) && !isTemplate(p));
const docOf = (p: Page): EditorNode[] => structuredClone(pageNodes(p));
const setDocument = (p: Page, nodes: EditorNode[]): void => { p.document = JSON.stringify(nodes); };

// ---------------------------------------------------------------- rows: what the documents say about tasks

export interface TaskRow { page: Page; node: EditorNode; role: "plan" | "reference" }
/** Every row of a task on every live page, in page order then document order. */
export function taskRows(state: Workspace, taskId: string): TaskRow[] {
  const out: TaskRow[] = [];
  for (const p of livePages(state)) for (const n of flatNodes(pageNodes(p))) if (rowTaskId(n) === taskId) out.push({ page: p, node: n, role: rowRole(n) });
  return out;
}
/** The day a task is planned for: the newest day page holding a plan row of it; null when none does. */
export function plannedOn(state: Workspace, taskId: string): string | null {
  let best: string | null = null;
  for (const r of taskRows(state, taskId)) if (r.role === "plan" && r.page.type === "daily" && r.page.date && (!best || r.page.date > best)) best = r.page.date;
  return best;
}
/** Planned days of every task at once, for the views. */
function plannedIndex(state: Workspace): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of livePages(state)) {
    if (p.type !== "daily" || !p.date) continue;
    for (const n of flatNodes(pageNodes(p))) {
      const id = rowTaskId(n);
      if (id && rowRole(n) === "plan" && (out.get(id) ?? "") < p.date) out.set(id, p.date);
    }
  }
  return out;
}
/** Tasks with a plan row on this day's page, in document order (a nested row right after its parent). */
function tasksOnDay(state: Workspace, day: string): Task[] {
  const p = dayPage(state, day);
  if (!p || isTrashed(p)) return [];
  const seen = new Set<string>(), out: Task[] = [];
  for (const n of flatNodes(pageNodes(p))) {
    const id = rowTaskId(n);
    if (!id || rowRole(n) !== "plan" || seen.has(id)) continue;
    const t = state.tasks.find((x) => x.id === id);
    if (!t) continue;
    seen.add(id); out.push(t);
  }
  return out;
}
/** A task whose title is empty after trimming: an empty checkbox row left on a page. It stays there, but no list shows it. */
export function isBlankTask(t: Task): boolean {
  return !t.title.trim();
}
/** The most recent day page before `day`. */
export function previousDayPage(state: Workspace, day: string): Page | undefined {
  return state.pages.filter((p) => p.type === "daily" && p.date !== null && p.date < day).sort((a, b) => (a.date! < b.date! ? 1 : -1))[0];
}
/** The task rows a task's row sat under on `from`, nearest first (other lines in between are skipped). */
export function carryAncestors(from: Page | undefined, taskId: string): string[] {
  if (!from) return [];
  const find = (list: EditorNode[], above: string[]): string[] | null => {
    for (const n of list) {
      if (rowTaskId(n) === taskId) return above;
      const own = rowTaskId(n), found = find(n.children ?? [], own && own !== taskId ? [own, ...above] : above);
      if (found) return found;
    }
    return null;
  };
  return find(pageNodes(from), []) ?? [];
}

// ---------------------------------------------------------------- document edits

/** Removes every node of `ids`, promoting its children into its place. */
function removeNodes(list: EditorNode[], ids: ReadonlySet<string>): EditorNode[] {
  const out: EditorNode[] = [];
  for (const n of list) {
    const children = removeNodes(n.children ?? [], ids);
    if (ids.has(n.id)) out.push(...children);
    else out.push(children.length || n.children ? { ...n, children } : n);
  }
  return out;
}
const rowIdsOf = (nodes: EditorNode[], taskId: string, role?: "plan" | "reference"): Set<string> =>
  new Set(flatNodes(nodes).filter((n) => rowTaskId(n) === taskId && (!role || rowRole(n) === role)).map((n) => n.id));
function setRole(nodes: EditorNode[], taskId: string, role: "plan" | "reference", planDate: string): boolean {
  let changed = false;
  for (const n of flatNodes(nodes)) if (rowTaskId(n) === taskId && (rowRole(n) !== role || (role === "plan" && n.props?.planDate !== planDate))) { n.props = { ...n.props, role, planDate: role === "plan" ? planDate : "" }; changed = true; }
  return changed;
}
function planRow(t: Task, day: string): EditorNode {
  return { id: newId(), type: "task", props: { taskId: t.id, role: "plan", planDate: day }, content: [textRun(t.title)], children: [] };
}
/**
 * B34b: a carried sub-task lands under its parent when the parent is on the page too, in the order they had on the
 * previous page; a parent that arrives after its sub-tasks takes them under it. A row already nested under one of its
 * ancestors moves only to a nearer one; one he nested elsewhere himself is left alone.
 */
function nestCarried(state: Workspace, p: Page, doc: EditorNode[], taskId: string): boolean {
  const from = previousDayPage(state, p.date ?? "");
  if (!from) return false;
  const order = new Map<string, number>();
  for (const n of flatNodes(pageNodes(from))) { const id = rowTaskId(n); if (id && !order.has(id)) order.set(id, order.size); }
  const parentOf = () => { const m = new Map<string, EditorNode | null>(); const walk = (l: EditorNode[], parent: EditorNode | null) => l.forEach((n) => { m.set(n.id, parent); walk(n.children ?? [], n); }); walk(doc, null); return m; };
  let moved = false;
  const nest = (child: string) => {
    const parents = parentOf();
    const row = flatNodes(doc).find((n) => rowTaskId(n) === child && rowRole(n) === "plan");
    if (!row) return;
    const ancestors = carryAncestors(from, child);
    const parent = parents.get(row.id) ?? null;
    const current = parent ? ancestors.indexOf(rowTaskId(parent) ?? "") : ancestors.length;
    if (current < 0) return;
    for (const ancestor of ancestors.slice(0, current)) {
      const under = flatNodes(doc).find((n) => rowTaskId(n) === ancestor && rowRole(n) === "plan");
      if (!under) continue;
      const siblings = parent ? parent.children! : doc;
      siblings.splice(siblings.indexOf(row), 1);
      const kids = (under.children ??= []), mine = order.get(child) ?? Infinity;
      const before = kids.findIndex((k) => (order.get(rowTaskId(k) ?? "") ?? -1) > mine);
      kids.splice(before < 0 ? kids.length : before, 0, row);
      moved = true;
      return;
    }
  };
  nest(taskId);
  for (const n of flatNodes(doc)) { const id = rowTaskId(n); if (id && id !== taskId && rowRole(n) === "plan" && carryAncestors(from, id).includes(taskId)) nest(id); }
  return moved;
}

/**
 * Plans `t` for `day`. A plan row stays where it was as history (the newest day is the plan); only the row on the page
 * the move is made from (unless that day is past) and rows on later days leave. The day's page is made if needed.
 */
function planOn(state: Workspace, t: Task, day: string, options: { from?: string; today?: string } = {}): void {
  date(day);
  for (const q of livePages(state)) {
    if (q.type !== "daily" || !q.date || q.date === day) continue;
    const ids = rowIdsOf(pageNodes(q), t.id, "plan");
    if (!ids.size) continue;
    const leaves = (options.from === q.date && (!options.today || q.date >= options.today)) || q.date > day;
    if (leaves) setDocument(q, removeNodes(docOf(q), ids));
  }
  const target = ensureDay(state, day);
  const doc = docOf(target);
  let changed = false;
  if (rowIdsOf(doc, t.id).size) changed = setRole(doc, t.id, "plan", day);
  else { doc.splice(rowInsertIndex(doc, new Set(state.tasks.map((x) => x.id))), 0, planRow(t, day)); changed = true; }
  if (nestCarried(state, target, doc, t.id)) changed = true;
  if (changed) setDocument(target, doc);
  if (t.paused) { t.paused = false; t.version++; }
}
/** After a task's rows left `p`: a task born there with no other row goes (tombstoned); today's plan row gone one at a time is Not today. */
function settleAfterRowsLeft(state: Workspace, p: Page, t: Task, options: { single: boolean; wasPlan: boolean; today?: string; plannedBefore: string | null }): void {
  const elsewhere = taskRows(state, t.id).some((r) => r.page.id !== p.id);
  if (!elsewhere && !t.paused) { tombstone(state, t); return; }
  if (options.single && options.wasPlan && p.type === "daily" && p.date && p.date === options.today && options.plannedBefore === p.date) { t.paused = true; t.version++; }
}
function tombstone(state: Workspace, t: Task): void {
  state.tasks = state.tasks.filter((x) => x.id !== t.id);
  state.deletedTasks = [...state.deletedTasks.filter((x) => x.id !== t.id), structuredClone(t)].slice(-tombstoneLimit);
}
function createTask(state: Workspace, title: string, p: Page, on: string, id = newId()): Task {
  const t: Task = { id, title: text(title, 1000), status: "open", version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: on, sourcePageId: p.id };
  state.tasks.push(t);
  return t;
}
function ensureDay(state: Workspace, day: string): Page {
  date(day);
  let p = dayPage(state, day);
  if (!p) {
    const id = `day:${day}`;
    if (state.pages.some((x) => x.id === id)) throw new DomainError("Page id already in use");
    const template = defaultTemplate(state, dayPagesTarget);
    p = { id, type: "daily", date: day, title: day, document: JSON.stringify(template ? pageFromTemplate(template, day) : templateDocument(id, day)) };
    state.pages.push(p);
  }
  return p;
}
function restorePages(state: Workspace, ids: Set<string>): { pages: Page[]; toTopLevel: Page[] } {
  const pages = state.pages.filter((p) => ids.has(p.id));
  const toTopLevel: Page[] = [];
  for (const p of pages) { delete p.trashedAt; delete p.trashId; }
  for (const p of pages) {
    if (!p.parentId || ids.has(p.parentId)) continue;
    const parent = state.pages.find((x) => x.id === p.parentId);
    if (!parent || isTrashed(parent)) { delete p.parentId; toTopLevel.push(p); }
  }
  return { pages, toTopLevel };
}
/** A4: what Restore on a page brings back: the page plus its descendants trashed in the same delete. */
function restoreSetOf(state: Workspace, p: Page): Set<string> {
  const ids = new Set([p.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of state.pages) if (isTrashed(x) && x.trashId === p.trashId && x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
  }
  return ids;
}
/** The page that owns a URL, live or in the trash (one page per key). */
export function urlOwner(state: Workspace, raw: string): { key: string | null; page?: Page } {
  const key = urlKey(raw);
  if (key === null) return { key };
  return { key, page: state.pages.find((p) => typeof p.url === "string" && urlKey(p.url) === key) };
}
/** The nearest heading above a node, at the top level of the document. */
function headingAbove(doc: EditorNode[], nodeId: string): EditorNode | undefined {
  let heading: EditorNode | undefined;
  for (const n of doc) {
    if (n.type === "heading") heading = n;
    if (n.id === nodeId || flatNodes(n.children ?? []).some((c) => c.id === nodeId)) return heading;
  }
  return undefined;
}
const bringableTypes = new Set(["paragraph", "bulletListItem", "numberedListItem", "quote"]);
const bringable = (n: EditorNode): boolean => bringableTypes.has(n.type) && Boolean(inlineText(n.content).trim());
/** Where a line goes at the end of a page: before its trailing empty text lines, so the line ready for typing stays last. */
function trailingStart(doc: readonly EditorNode[]): number {
  let end = doc.length;
  while (end > 0 && isEmptyLine(doc[end - 1]!) && doc[end - 1]!.type !== "task") end--;
  return end;
}
const lineKey = (n: EditorNode, pageDate: string | null) => inlineText(n.content, pageDate).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- commands

function execute(state: Workspace, action: Action, operationId: string): { message: string; entityId?: string } {
  switch (action.type) {
    case "save-editor": {
      const p = page(state, action.pageId);
      if (pageContentKey(p) !== action.expectedContent) throw new DomainError("Page changed elsewhere. Your editor draft is kept; reload or copy it before resolving.");
      let nodes: EditorNode[];
      try { nodes = JSON.parse(text(action.document, 2_000_000)); } catch { throw new DomainError("Invalid editor document"); }
      if (!Array.isArray(nodes) || nodes.length > 5000) throw new DomainError("Invalid editor document");
      const all = flatNodes(nodes);
      if (all.length > 20_000) throw new DomainError("Invalid editor document");
      cleanRuns(nodes);
      const ids = new Set<string>();
      for (const n of all) { if (!n || typeof n.id !== "string" || !n.id || typeof n.type !== "string" || ids.has(n.id)) throw new DomainError("Duplicate editor block identity"); ids.add(n.id); }
      if (isTemplate(p)) { setDocument(p, templateRows(nodes)); return { message: "Template saved" }; }
      const before = flatNodes(pageNodes(p));
      const on = action.today ?? p.date ?? new Date().toISOString().slice(0, 10);
      const previousText = new Map(before.filter(isTaskRow).map((n) => [n.id, inlineText(n.content, textDate(p))]));
      // Rows: an existing task's words, a deleted task's return, a new task.
      for (const n of all) {
        const id = rowTaskId(n);
        if (n.type === "task" && !id) throw new DomainError("Unknown Task identity");
        if (!id) continue;
        const words = inlineText(n.content, textDate(p));
        const existing = state.tasks.find((t) => t.id === id);
        if (existing) {
          const prior = previousText.get(n.id);
          // The row's words changed on this page (or the row is new here) and differ from the title: the title follows.
          if ((prior === undefined || prior !== words) && words !== existing.title) { existing.title = text(words, 1000); existing.version++; }
          continue;
        }
        const buried = state.deletedTasks.find((t) => t.id === id);
        if (buried) { state.deletedTasks = state.deletedTasks.filter((t) => t.id !== id); state.tasks.push(buried); continue; }
        if (!words.trim()) continue;
        createTask(state, words, p, on, id);
        // A task born in a row on a day page is planned there: a reference row (an old build's empty template row) has nothing to refer to yet.
        if (p.type === "daily" && p.date && rowRole(n) !== "plan") n.props = { ...n.props, role: "plan", planDate: p.date };
      }
      // Rows gone: a task with no row anywhere goes with its line; today's plan row removed one at a time is Not today.
      const cut = new Set(action.cutTaskIds ?? []), single = new Set(action.singleDeleteIds ?? []);
      const after = new Set(all.map(rowTaskId).filter((x): x is string => x !== null));
      const gone = new Map<string, EditorNode[]>();
      for (const n of before) { const id = rowTaskId(n); if (id && !after.has(id) && !cut.has(id)) gone.set(id, [...(gone.get(id) ?? []), n]); }
      const plannedBefore = new Map([...gone.keys()].map((id) => [id, plannedOn(state, id)]));
      // Stamps: a reference's time is the revision of the save that first held it.
      const at = state.revision + 1;
      for (const n of all) {
        if (n.type === "pageLink" && n.props?.at === undefined) n.props = { ...n.props, at };
        if (Array.isArray(n.content)) for (const c of n.content as { type?: string; props?: Record<string, unknown> }[]) if (c?.type === "pageRef" && c.props && c.props.at === undefined) c.props.at = at;
      }
      setDocument(p, nodes);
      for (const [id, rows] of gone) {
        const t = state.tasks.find((x) => x.id === id);
        if (!t) continue;
        settleAfterRowsLeft(state, p, t, { single: rows.some((r) => single.has(r.id)), wasPlan: rows.some((r) => rowRole(r) === "plan"), today: action.today, plannedBefore: plannedBefore.get(id) ?? null });
      }
      return { message: "Page saved" };
    }
    case "ensure-day": {
      const p = ensureDay(state, action.date);
      return { message: "Day opened", entityId: p.id };
    }
    case "add-task": {
      const p = ordinaryPage(state, action.pageId);
      const on = action.plannedOn ?? p.date ?? new Date().toISOString().slice(0, 10);
      const t = createTask(state, action.title, p, on);
      if (action.deadlineOn) t.deadlineOn = date(action.deadlineOn);
      if (action.attentionOn) t.attentionOn = date(action.attentionOn);
      const plannedHere = Boolean(action.plannedOn && p.type === "daily" && p.date === action.plannedOn);
      const doc = docOf(p);
      const row = plannedHere ? planRow(t, p.date!) : { ...planRow(t, ""), props: { taskId: t.id, role: "reference", planDate: "" } };
      doc.splice(rowInsertIndex(doc, new Set(state.tasks.map((x) => x.id))), 0, row);
      setDocument(p, doc);
      if (action.plannedOn && !plannedHere) planOn(state, t, date(action.plannedOn));
      return { message: "Task added", entityId: t.id };
    }
    case "task-status": {
      const t = task(state, action.taskId);
      t.status = action.status;
      t.doneOn = action.status === "done" ? (action.today ? date(action.today) : null) : null;
      t.version++;
      return { message: action.status === "done" ? "Done" : action.status === "cancelled" ? "Cancelled" : "Reopened", entityId: t.id };
    }
    case "plan-task": {
      const t = task(state, action.taskId);
      if (action.from) date(action.from);
      if (action.today) date(action.today);
      planOn(state, t, action.date, { from: action.from, today: action.today });
      return { message: `Planned for ${action.date}`, entityId: t.id };
    }
    case "plan-tasks": {
      date(action.date);
      for (const item of action.items) planOn(state, task(state, item.taskId), action.date);
      return { message: `Added ${action.items.length}` };
    }
    case "not-today": {
      const t = task(state, action.taskId);
      date(action.date);
      if (!action.onlyThisDay || plannedOn(state, t.id) === action.date) t.paused = true;
      const p = dayPage(state, action.date);
      if (p) { const ids = rowIdsOf(pageNodes(p), t.id, "plan"); if (ids.size) setDocument(p, removeNodes(docOf(p), ids)); }
      t.version++;
      return { message: t.paused ? "Not today" : "Removed from the day", entityId: t.id };
    }
    case "remove-task-row": {
      const p = ordinaryPage(state, action.pageId), t = task(state, action.taskId);
      const ids = rowIdsOf(pageNodes(p), t.id);
      if (!ids.size) throw new DomainError("Row not found");
      const wasPlan = rowIdsOf(pageNodes(p), t.id, "plan").size > 0, plannedBefore = plannedOn(state, t.id);
      setDocument(p, removeNodes(docOf(p), ids));
      settleAfterRowsLeft(state, p, t, { single: true, wasPlan, today: date(action.today), plannedBefore });
      return { message: "Removed", entityId: t.id };
    }
    case "bring-line": {
      const p = dayPage(state, date(action.date));
      if (!p) throw new DomainError("Page not found");
      const source = ordinaryPage(state, action.sourcePageId);
      const sourceDoc = pageNodes(source);
      const node = flatNodes(sourceDoc).find((n) => n.id === action.sourceBlockId);
      if (!node) throw new DomainError("Line not found");
      if (!bringable(node)) throw new DomainError("Only text lines can be brought");
      const key = lineKey(node, textDate(source));
      if (flatNodes(pageNodes(p)).some((n) => lineKey(n, textDate(p)) === key)) throw new DomainError("Already brought");
      const freshRefs = (content: unknown): unknown => Array.isArray(content) ? content.map((c) => c?.type === "pageRef" ? { ...c, props: { ...c.props, refId: newId() } } : c) : content;
      const copy: EditorNode = { id: newId(), type: node.type, props: {}, content: freshRefs(node.content), children: [] };
      const doc = docOf(p);
      const fromHeading = headingAbove(sourceDoc, node.id), fromTitle = fromHeading ? inlineText(fromHeading.content).trim().toLowerCase() : "";
      const sameName = (n: EditorNode) => n.type === "heading" && inlineText(n.content).trim().toLowerCase() === fromTitle;
      const target = (fromTitle ? doc.find(sameName) : undefined) ?? doc.find((n) => n.type === "heading" && inlineText(n.content).trim().toLowerCase() === "notes");
      // A heading he removed from his day is never brought back (B70): with neither heading, the line goes at the end.
      if (target) doc.splice(sectionInsertIndex(doc, target.id), 0, copy);
      else doc.splice(trailingStart(doc), 0, copy);
      setDocument(p, doc);
      return { message: target ? `Brought to ${inlineText(target.content).trim()}` : "Brought to today", entityId: copy.id };
    }
    case "handoff-done": {
      ensureDay(state, action.date).handoffDone = true;
      return { message: "Day started" };
    }
    case "save-review": {
      ensureDay(state, action.date).reviewSaved = true;
      return { message: "Review saved" };
    }
    case "create-document": {
      const id = action.pageId ?? newId();
      if (id === dayPagesTarget || id === daySubpagesTarget) throw new DomainError("Page id already in use");
      const existing = state.pages.find((p) => p.id === id);
      if (existing) {
        if (existing.type !== "document" || (existing.parentId ?? null) !== (action.parentId ?? null)) throw new DomainError("Page id already in use");
        return { message: "Page saved", entityId: id };
      }
      const parent = action.parentId ? ordinaryPage(state, action.parentId) : undefined;
      const body = text(action.body);
      const line = emptyLine("paragraph");
      if (body) line.content = [textRun(body)];
      // B70: a new empty page made inside a page starts from that target's default template; its title isn't copied.
      const template = parent && !body ? subpageTemplate(state, parent) : undefined;
      const nodes = template ? pageFromTemplate(template, null) : [line];
      state.pages.push({ id, type: "document", date: null, title: text(action.title, 1000), ...(action.parentId ? { parentId: action.parentId } : {}), document: JSON.stringify(nodes) });
      return { message: "Page saved", entityId: id };
    }
    case "make-link-pages": {
      const parent = ordinaryPage(state, action.parentPageId);
      let first: string | undefined;
      for (const item of action.items) {
        if (state.pages.some((p) => p.id === item.pageId)) { first ??= item.pageId; continue; }
        const url = text(item.url.trim(), 10_000);
        const owner = urlOwner(state, url);
        if (owner.key === null) throw new DomainError("Use an http(s) link");
        if (!owner.page) {
          const linkText = item.title?.trim();
          const title = linkText && linkText !== url ? text(linkText, 1000) : defaultLinkTitle(url);
          state.pages.push({ id: item.pageId, type: "document", date: null, title, url, parentId: parent.id, document: JSON.stringify([emptyLine("paragraph")]) });
          first ??= item.pageId;
        } else {
          if (isTrashed(owner.page)) restorePages(state, restoreSetOf(state, owner.page));
          first ??= owner.page.id;
        }
      }
      return { message: "Links saved", entityId: first };
    }
    case "apply-link-preview": {
      const unchanged = { message: "Link page unchanged" };
      const p = state.pages.find((x) => x.id === action.pageId);
      if (!p || isTrashed(p) || p.url !== action.url) return unchanged;
      const nodes = pageNodes(p);
      const untouched = nodes.length === 1 && isEmptyLine(nodes[0]!) && !state.pages.some((c) => c.parentId === p.id && !isTrashed(c));
      if (!untouched) return unchanged;
      const title = action.title?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
      const description = action.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
      const quote = description && description.toLocaleLowerCase() !== (title ?? p.title).toLocaleLowerCase() ? description : null;
      if (!title && !quote) return unchanged;
      if (title) p.title = title;
      if (quote) setDocument(p, [{ id: newId(), type: "quote", props: {}, content: [textRun(quote)], children: [] }, emptyLine("paragraph", nodes[0]!.id)]);
      return { message: title ? `Named '${p.title}'` : "Link page filled in", entityId: p.id };
    }
    case "rename-page": {
      const p = page(state, action.pageId);
      if (p.type === "daily") throw new DomainError("Day pages are named by their date");
      p.title = text(action.title, 1000).trim();
      return { message: "Page renamed", entityId: p.id };
    }
    case "move-page": {
      const refusal = moveRefusal(state, action.pageId, action.parentId);
      if (refusal) throw new DomainError(refusal);
      const index = state.pages.findIndex((p) => p.id === action.pageId);
      const [moved] = state.pages.splice(index, 1);
      if (action.parentId) moved!.parentId = action.parentId; else delete moved!.parentId;
      state.pages.push(moved!);
      return { message: action.parentId ? "Page moved" : "Moved to top level", entityId: moved!.id };
    }
    case "delete-page": {
      const p = page(state, action.pageId);
      if (p.type !== "document") throw new DomainError("Day pages can't be deleted");
      if (!Number.isFinite(Date.parse(action.at))) throw new DomainError("Invalid time");
      const ids = subtreeIds(state, p.id);
      const members = state.pages.filter((x) => ids.has(x.id) && !isTrashed(x));
      for (const x of members) { x.trashedAt = action.at; x.trashId = operationId; }
      const n = members.length - 1;
      return { message: n ? `Moved to trash · ${n} subpage${n === 1 ? "" : "s"}` : "Moved to trash", entityId: p.id };
    }
    case "restore-page": {
      const p = page(state, action.pageId);
      if (!isTrashed(p)) throw new DomainError("Page is not in trash");
      const { toTopLevel } = restorePages(state, restoreSetOf(state, p));
      return { message: toTopLevel.length ? "Restored to Pages" : "Restored", entityId: p.id };
    }
    case "restore-batch": {
      const ids = new Set(state.pages.filter((x) => isTrashed(x) && x.trashId === action.trashId).map((x) => x.id));
      if (!ids.size) throw new DomainError("Nothing left to restore");
      const { pages, toTopLevel } = restorePages(state, ids);
      const top = pages.find((x) => !x.parentId || !ids.has(x.parentId))!;
      return { message: toTopLevel.includes(top) ? "Restored to Pages" : "Restored", entityId: top.id };
    }
    case "create-template": {
      const id = action.pageId ?? newId();
      const existing = state.pages.find((p) => p.id === id);
      if (existing) {
        if (!isTemplate(existing)) throw new DomainError("Page id already in use");
        return { message: "Template saved", entityId: id };
      }
      // "Day page" starts from the built-in headings and becomes the day pages' default (Templates list). If day pages
      // already have one (a second Edit from another tab or a double click), that one is opened instead of a copy.
      const existingDay = action.dayPage ? defaultTemplate(state, dayPagesTarget) : undefined;
      if (existingDay) return { message: "Template saved", entityId: existingDay.id };
      const nodes = action.dayPage ? builtInDayNodes() : [emptyLine("paragraph")];
      const title = action.dayPage ? dayTemplateTitle : text(action.title, 1000).trim();
      if (action.dayPage) for (const t of state.pages) if (isTemplate(t) && t.parentId === dayPagesTarget) delete t.parentId;
      state.pages.push({ id, type: "template", date: null, title, ...(action.dayPage ? { parentId: dayPagesTarget } : {}), document: JSON.stringify(nodes) });
      return { message: "Template saved", entityId: id };
    }
    case "set-template-target": {
      const p = page(state, action.pageId);
      if (!isTemplate(p)) throw new DomainError("Not a template");
      const target = action.target;
      let where = "";
      if (target === dayPagesTarget) where = "day pages";
      else if (target === daySubpagesTarget) where = "pages inside days";
      else if (target) {
        const on = ordinaryPage(state, target);
        if (isTrashed(on)) throw new DomainError("Page is in trash");
        where = `pages in ${on.type === "daily" ? on.date : on.title.trim() || "Untitled"}`;
      }
      // One default per target: setting it here takes it from any other template.
      if (target) for (const t of state.pages) if (isTemplate(t) && t.id !== p.id && t.parentId === target) delete t.parentId;
      if (target) p.parentId = target; else delete p.parentId;
      return { message: target ? `Now the default for ${where}` : "No longer a default", entityId: p.id };
    }
    case "delete-template": {
      // A straight delete, no Trash (states §2); its default goes with it, and Undo brings both back.
      const p = page(state, action.pageId);
      if (!isTemplate(p)) throw new DomainError("Not a template");
      state.pages = state.pages.filter((x) => x.id !== p.id);
      return { message: `Deleted '${p.title.trim() || "Untitled"}'`, entityId: p.id };
    }
    case "set-timezone":
      state.timezone = validTimezone(action.timezone);
      return { message: "Time zone saved" };
    case "undo":
      throw new DomainError("Unreachable");
  }
}

// ---------------------------------------------------------------- views

export function getDayView(state: Workspace, day: string): DayView {
  date(day);
  const current = dayPage(state, day) ?? null;
  const planned = plannedIndex(state);
  const listed = state.tasks.filter((t) => !isBlankTask(t));
  const onDay = tasksOnDay(state, day).filter((t) => !isBlankTask(t));
  const openPool = listed.filter((t) => t.status === "open" && !t.paused && ((planned.get(t.id) ?? "") <= day));
  const previous = previousDayPage(state, day);
  const previousIds = new Set(previous ? tasksOnDay(state, previous.date!).map((t) => t.id) : []);
  const handoffTasks = openPool.filter((t) => previousIds.has(t.id) && planned.get(t.id) !== day);
  const handoffIds = new Set(handoffTasks.map((t) => t.id));
  const carry = openPool
    .filter((t) => { const last = planned.get(t.id); return last !== undefined && last < day && !handoffIds.has(t.id); })
    .sort((a, b) => planned.get(a.id)!.localeCompare(planned.get(b.id)!) || a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id))
    .slice(0, 3);
  const here = new Set(current ? flatNodes(pageNodes(current)).map((n) => lineKey(n, textDate(current))).filter(Boolean) : []);
  const handoffBlocks = previous && !isTrashed(previous)
    ? flatNodes(pageNodes(previous)).filter((n) => bringable(n) && !here.has(lineKey(n, textDate(previous)))).map((block) => ({ pageId: previous.id, block }))
    : [];
  return {
    page: current,
    planned: onDay.filter((t) => t.status === "open"),
    dayTasks: onDay,
    openPool,
    handoffTasks,
    handoffBlocks,
    carry,
    paused: listed.filter((t) => t.status === "open" && t.paused),
    attention: listed.filter((t) => t.status === "open" && ((!!t.deadlineOn && t.deadlineOn <= day) || (!!t.attentionOn && t.attentionOn <= day))),
    get events() { return dayEvents(state, day); },
  };
}
/** The calendar's list for a day: planned there, then due there. */
export function getCalendarTasks(state: Workspace, day: string): Task[] {
  const planned = getDayView(state, day).planned;
  const ids = new Set(planned.map((t) => t.id));
  const due = state.tasks.filter((t) => t.status === "open" && !isBlankTask(t) && t.deadlineOn === day && !ids.has(t.id));
  return [...planned, ...due];
}

// ---------------------------------------------------------------- receipts, replay, Undo

const fingerprintPrefix = "c128:";
const expiredFingerprint = "expired";
export const receiptWindow = 500;
export const tombstoneWindow = 3000;
/** cyrb128: a fast 128-bit string hash (public domain). An identity check, not a security boundary. */
function cyrb128(text: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233); h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233); h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}
export function commandFingerprint(serializedAction: string): string {
  return fingerprintPrefix + cyrb128(serializedAction);
}
function sameFingerprint(stored: string | undefined, serializedAction: string): boolean {
  if (stored === undefined) return false;
  return stored.startsWith(fingerprintPrefix) ? stored === commandFingerprint(serializedAction) : stored === serializedAction;
}
/** Newest receipts whole, the older ones as tombstones, the rest dropped. */
export function compactReceipts(receipts: Workspace["receipts"]): Workspace["receipts"] {
  const all = Object.values(receipts), whole = all.slice(-receiptWindow);
  const expired = all.slice(Math.max(0, all.length - receiptWindow - tombstoneWindow), Math.max(0, all.length - receiptWindow));
  const out: Workspace["receipts"] = {};
  for (const r of expired) out[r.operationId] = { operationId: r.operationId, message: "", fingerprint: expiredFingerprint };
  for (const r of whole) out[r.operationId] = r.fingerprint && !r.fingerprint.startsWith(fingerprintPrefix) && r.fingerprint !== expiredFingerprint ? { ...r, fingerprint: commandFingerprint(r.fingerprint) } : r;
  return out;
}

export function applyCommand(input: Workspace, command: Command): CommandResult {
  if (!command || typeof command.operationId !== "string" || !command.operationId || !command.action || command.operationId.length > 200) throw new DomainError("Invalid command");
  const serialized = JSON.stringify(command.action);
  const existing = input.receipts[command.operationId];
  if (existing) {
    if (existing.fingerprint === expiredFingerprint) throw new DomainError("This change was already applied · reload");
    if (!sameFingerprint(existing.fingerprint, serialized)) throw new DomainError("Operation identity reused with different input");
    return { workspace: structuredClone(input), receipt: existing };
  }
  const fingerprint = commandFingerprint(serialized);
  if (command.expectedRevision !== input.revision) throw new DomainError("Saved elsewhere. Reload before applying; your input is kept here.");
  let state = structuredClone(input);
  const { undo: _previousUndo, receipts: _receipts, ...rest } = input;
  const before = { ...structuredClone(rest), receipts: {} as Workspace["receipts"] };
  let result: { message: string; entityId?: string };
  if (command.action.type === "undo") {
    const previous = input.undo;
    if (!previous?.before || previous.operationId !== command.action.targetOperationId || previous.revision !== input.revision) throw new DomainError("Cannot undo after later changes; current values kept");
    state = { ...structuredClone(previous.before), revision: input.revision, receipts: structuredClone(input.receipts) };
    result = { message: "Previous operation restored" };
  } else result = execute(state, command.action, command.operationId);
  state.revision = input.revision + 1;
  const receipt = { operationId: command.operationId, ...result, fingerprint };
  state.receipts = compactReceipts({ ...state.receipts, [command.operationId]: receipt });
  if (!["undo", "ensure-day"].includes(command.action.type)) state.undo = { operationId: command.operationId, revision: state.revision, before };
  else delete state.undo;
  return { workspace: state, receipt };
}
