import { dayTemplate, editorSeed, needsTemplateRows, pageContentKey, projectDocument, inlineText, sectionRange, type EditorNode } from "./editor-document.ts";
import { isTrashed, moveRefusal, subtreeIds } from "./page-tree.ts";
import { draftLines, fingerprintOf, isLineLinked, liveProposal, previousDayPage } from "./draft.ts";
import type {
  Command,
  CommandResult,
  DayView,
  Workspace,
  Page,
  Task,
  Section,
  Material,
  NoteBlock,
  Action,
  ProposalItem,
  ServerAction,
  Capture,
} from "./types.ts";
export class DomainError extends Error {}
export function createEmptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    revision: 0,
    timezone: "America/Vancouver",
    pages: [],
    tasks: [],
    events: [],
    placements: [],
    materials: [],
    captures: [],
    receipts: {},
  };
}
function requireValue<T>(value: T | undefined, name: string): T {
  if (!value) throw new DomainError(`${name} not found`);
  return value;
}
const newId = () => crypto.randomUUID();
function date(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new DomainError("Invalid calendar date");
  return value;
}
function text(value: string, limit = 100_000): string {
  if (typeof value !== "string" || value.length > limit)
    throw new DomainError("Text exceeds limit");
  return value;
}
export function addDays(value: string, days: number): string {
  const d = new Date(`${date(value)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function page(state: Workspace, id: string) {
  return requireValue(
    state.pages.find((p) => p.id === id),
    "Page",
  );
}
function section(p: Page, id: string) {
  return requireValue(
    p.sections.find((s) => s.id === id),
    "Section",
  );
}
function task(state: Workspace, id: string) {
  return requireValue(
    state.tasks.find((t) => t.id === id),
    "Task",
  );
}
function material(state: Workspace, id: string) {
  return requireValue(
    state.materials.find((m) => m.id === id),
    "Material",
  );
}
function ensureDay(state: Workspace, day: string): Page {
  date(day);
  let p = state.pages.find((p) => p.type === "daily" && p.date === day);
  if (!p) {
    const id = `day:${day}`;
    p = {
      id,
      type: "daily",
      date: day,
      title: day,
      reviewText: "",
      reviewSaved: false,
      handoffDone: false,
      draft: null,
      sections: dayTemplate.map(({ kind, title }) => ({
        id: `${id}:${kind}`,
        kind,
        title,
        blocks: [],
      })),
    };
    state.pages.push(p);
    // Planning stores only a placement (R9), so a new page shows what was already planned for its day (R5).
    const planned = state.placements
      .map((placement, index) => ({ placement, index }))
      .filter(({ placement }) => placement.date === day && placement.state === "included")
      .sort((a, b) => (a.placement.order ?? 1e9) - (b.placement.order ?? 1e9) || a.index - b.index);
    for (const { placement } of planned) {
      const t = state.tasks.find((t) => t.id === placement.taskId);
      if (!t || t.status !== "open" || t.plannedOn !== day) continue;
      appendBlock(p, ensureSection(p, placement.section), { id: newId(), kind: "task", taskId: t.id, text: t.title });
    }
  }
  return p;
}
// New rows go above a section's trailing empty lines, so the empty row ready for typing stays last.
// Emptiness comes from the editor document: an image or table also projects to a text-less paragraph block.
function appendBlock(p: Page, s: Section, block: NoteBlock): void {
  const nodes = new Map<string, EditorNode>();
  const remember = (n: EditorNode) => { nodes.set(n.id, n); n.children?.forEach(remember); };
  if (p.editorJSON) (JSON.parse(p.editorJSON) as EditorNode[]).forEach(remember);
  const isEmptyRow = (b: NoteBlock) => {
    // A starter task row saved before it had text: its draft identity, no Task behind it (Jazz 985b009b).
    if (b.kind === "task" && b.taskId === `editor-task:${b.id}` && !b.text.trim()) return true;
    if (b.kind !== "paragraph" || b.text.trim()) return false;
    const node = nodes.get(b.id);
    if (!node) return !p.editorJSON;
    if (inlineText(node.content) || node.children?.length) return false;
    return node.type === "paragraph" || node.type === "bulletListItem" || (node.type === "task" && node.props?.taskId === `editor-task:${node.id}`);
  };
  let at = s.blocks.length;
  while (at > 0 && isEmptyRow(s.blocks[at - 1]!)) at--;
  s.blocks.splice(at, 0, block);
}
function ensureSection(p: Page, kind: Section["kind"]): Section {
  let s = p.sections.find((s) => s.kind === kind);
  if (!s) {
    s = {
      id: newId(),
      kind,
      title: dayTemplate.find((t) => t.kind === kind)?.title ?? kind,
      blocks: [],
    };
    // A plan section that was removed comes back at the top, in template order (morning card §6).
    if (kind === "top3") p.sections.unshift(s);
    else if (kind === "other") p.sections.splice(p.sections.findIndex((x) => x.kind === "top3") + 1, 0, s);
    else p.sections.push(s);
  }
  return s;
}
function createTask(
  state: Workspace,
  title: string,
  sourcePage: Page,
  planned: string | null,
  dates: { attentionOn?: string | null; deadlineOn?: string | null } = {},
): Task {
  if (!text(title, 1000).trim()) throw new DomainError("Task title is empty");
  if (planned) date(planned);
  if (dates.attentionOn) date(dates.attentionOn);
  if (dates.deadlineOn) date(dates.deadlineOn);
  const t: Task = {
    id: newId(),
    title: title.trim(),
    status: "open",
    version: 1,
    plannedOn: planned,
    attentionOn: dates.attentionOn ?? null,
    deadlineOn: dates.deadlineOn ?? null,
    paused: false,
    createdOn:
      sourcePage.date ??
      new Date().toLocaleDateString("en-CA", { timeZone: state.timezone }),
    lastPlannedOn: planned,
    sourcePageId: sourcePage.id,
  };
  state.tasks.push(t);
  return t;
}
function place(
  state: Workspace,
  t: Task,
  day: string,
  target: "top3" | "other" = "other",
) {
  date(day);
  for (const p of state.placements)
    if (p.taskId === t.id && p.state === "included" && p.date !== day)
      p.state = "moved";
  t.plannedOn = day;
  t.lastPlannedOn = day;
  t.paused = false;
  t.version++;
  const old = state.placements.find((p) => p.taskId === t.id && p.date === day);
  if (old) {
    old.state = "included";
    old.section = target;
  } else
    state.placements.push({
      taskId: t.id,
      date: day,
      state: "included",
      section: target,
    });
  // Planning never creates a day page; ensureDay renders this placement when the page is created.
  const p = state.pages.find((p) => p.type === "daily" && p.date === day);
  if (!p) return;
  // Only plan sections own arrangement rows; ordinary Notes references stay put.
  let arrangement: NoteBlock | undefined;
  for (const s of p.sections) {
    if (s.kind !== "top3" && s.kind !== "other") continue;
    const rows = s.blocks.filter(b => b.kind === "task" && b.taskId === t.id);
    arrangement ??= rows[0];
    s.blocks = s.blocks.filter(b => !(b.kind === "task" && b.taskId === t.id));
  }
  if (arrangement) appendBlock(p, ensureSection(p, target), arrangement);
  else
    appendBlock(p, ensureSection(p, target), {
      id: newId(),
      kind: "task",
      taskId: t.id,
      text: t.title,
    });
}
/** Top 3 holds three tasks on that day's page. */
export function top3Full(state: Workspace, day: string): boolean {
  const p = state.pages.find((x) => x.type === "daily" && x.date === day);
  return (p?.sections.filter((s) => s.kind === "top3").flatMap((s) => s.blocks).filter((b) => b.kind === "task" && b.taskId).length ?? 0) >= 3;
}
function pause(state: Workspace, t: Task, day: string) {
  date(day);
  t.paused = true;
  if (t.plannedOn === day) t.plannedOn = null;
  t.version++;
  const old = state.placements.find((p) => p.date === day && p.taskId === t.id);
  if (old) old.state = "excluded";
  else
    state.placements.push({
      taskId: t.id,
      date: day,
      state: "excluded",
      section: "other",
    });
  const p = state.pages.find((p) => p.type === "daily" && p.date === day);
  // Ordinary task references in Notes remain. Only plan presentations leave the plan.
  if (p)
    for (const s of p.sections)
      if (s.kind === "top3" || s.kind === "other")
        s.blocks = s.blocks.filter((b) => b.taskId !== t.id);
}
function saveMaterial(
  state: Workspace,
  p: Page,
  s: Section,
  url: string,
  title: string,
  body = "",
  note = "",
): Material {
  const m = findOrCreateMaterial(state, p, url, title, body);
  const b: NoteBlock = {
    id: newId(),
    kind: "material",
    materialId: m.id,
    text: text(note) || title || url,
  };
  appendBlock(p, s, b);
  m.sources.push({ pageId: p.id, blockId: b.id, note: text(note) });
  return m;
}
/** One Material per exact URL (04 P14); saving a "Done with it" URL again puts it back to sort (Addendum G05). */
function findOrCreateMaterial(
  state: Workspace,
  p: Page,
  url: string,
  title: string,
  body = "",
  newMaterialId: string = newId(),
): Material {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new DomainError("Use an http(s) source URL");
  let m = state.materials.find((m) => m.url === url);
  const day =
    p.date ??
    new Date().toLocaleDateString("en-CA", { timeZone: state.timezone });
  if (!m) {
    m = {
      id: newMaterialId,
      url,
      title: text(title, 1000).trim() || url,
      body: text(body),
      savedOn: day,
      reviewState: "pending",
      nextReviewOn: null,
      resurface: true,
      lastDecisionOn: null,
      skippedUntil: null,
      sources: [],
      decisions: [],
    };
    state.materials.push(m);
  } else if (m.reviewState === "done") {
    m.reviewState = "pending";
    m.nextReviewOn = null;
    m.skippedUntil = null;
    m.savedOn = day;
    m.decisions = [
      ...(m.decisions ?? []),
      { date: day, decision: "saved-again" },
    ];
  }
  return m;
}
const httpUrl = (value: string): string | null => {
  const v = value.trim();
  if (!/^https?:\/\/\S+$/.test(v)) return null;
  try { new URL(v); return v; } catch { return null; }
};
type InlinePart = { type?: string; href?: string; content?: unknown; text?: string };
/**
 * The link a line holds when it holds nothing else: a bare URL, or one titled link such as Brian's
 * `[xx](url)` with only spaces around it. A sentence containing a link doesn't count.
 */
function lineLink(node: EditorNode | undefined, text: string): { url: string; title: string } | null {
  const parts = Array.isArray(node?.content) ? (node!.content as InlinePart[]) : [];
  const links = parts.filter((c) => c?.type === "link");
  const onlyLink = links.length === 1 && parts.every((c) => c === links[0] || (c?.type === "text" && !String(c.text ?? "").trim()));
  if (onlyLink) {
    const url = httpUrl(String(links[0]!.href ?? ""));
    if (url) return { url, title: inlineText(links[0]!.content).trim() || url };
  }
  const url = httpUrl(text);
  return url ? { url, title: url } : null;
}
/** Brian's words on a saved line, without the link itself: the note for that save (04 P14). */
function lineNote(node: EditorNode | undefined, text: string, url: string): string {
  const parts = Array.isArray(node?.content) ? (node!.content as InlinePart[]) : [];
  const rest = parts.some((c) => c?.type === "link" && c.href === url)
    ? parts.filter((c) => !(c?.type === "link" && c.href === url)).map((c) => inlineText([c])).join("")
    : text.split(url).join("");
  return rest.trim().replace(/^[\s\-–—:·|,]+/, "").trim();
}
/** Created by this line's save and never acted on or annotated: the only Material the editor may re-key. */
function untouchedLineMaterial(m: Material, blockId: string, previous: EditorNode | undefined): boolean {
  // The title is still the one this line's link gave it, so nobody has renamed the item since.
  const lineTitle = previous ? lineLink(previous, inlineText(previous.content))?.title : undefined;
  return m.id === `material:${blockId}` && m.title === (lineTitle ?? m.url) && m.sources.length === 1 && m.sources[0]!.blockId === blockId && !m.sources[0]!.note
    && m.reviewState === "pending" && m.resurface && !m.body && m.nextReviewOn === null && m.lastDecisionOn === null
    && !m.skippedUntil && !m.taskId && !m.openedOn?.length && !m.dismissedOn?.length && !m.decisions?.length;
}
/**
 * Editor path of 01 §6.1 / P14: a link alone on a line in the material section (Good Stuffs, by kind, so a
 * renamed heading still counts) becomes a saved Material, as add-text did. Saving never deletes a Material
 * that holds anything beyond a URL the line itself typed.
 * Saves are debounced while Brian types, so an untouched Material follows its line from one URL to the next
 * (re-keyed); words added to the line become that save's note, and a deleted line leaves the Material alone.
 */
/** One draft per day (morning-model-states §1): a ready draft or a run in progress; a failed run allows Retry. */
function hasDayDraft(p: Page): boolean {
  if (!p.draft) return false;
  return !p.draft.run || p.draft.run.status === "ready" || p.draft.run.status === "drafting";
}
function draftingPage(state: Workspace, day: string, runId: string): Page {
  const p = state.pages.find((x) => x.type === "daily" && x.date === date(day));
  if (!p?.draft?.run || p.draft.run.runId !== runId || p.draft.run.status !== "drafting") throw new DomainError("Draft run moved on");
  return p;
}
/** The card's failure lines (morning-model-states §3, capture receipt wording). */
export const draftFailureLine: Record<import("./types.ts").DraftFailure, string> = {
  "key-rejected": "Model key rejected · nothing was added",
  unavailable: "Model unavailable · nothing was added",
  paused: "Model paused · a cost couldn't be confirmed · nothing was added",
  budget: "Today's model budget is used up · nothing was added",
  "too-large": "Too much to read in one go · nothing was added",
  busy: "Model busy · nothing was added",
};
/** A line Bring to today can copy: text or a link, not a task, page card or event. */
function bringable(b: NoteBlock): boolean {
  return !b.taskId && !b.eventId && b.kind !== "reference" && !b.targetPageId && Boolean(b.text.trim());
}
/**
 * Today holds, or once held, a copy of that line. "Once held" depends on save-editor keeping a deleted block in
 * `editorBlockMetadata` (it never prunes it); if that ever changes, a deleted copy's line is offered again. The test
 * "a copy deleted later is not offered again" deletes through save-editor, so it fails if that behaviour changes.
 * Undo restores the whole page from before, metadata included, so the line is offered again.
 */
function wasBrought(today: Page, sourcePageId: string, sourceBlockId: string): boolean {
  return [...today.sections.flatMap((s) => s.blocks), ...Object.values(today.editorBlockMetadata ?? {})]
    .some((b) => b.sourcePageId === sourcePageId && b.sourceBlockId === sourceBlockId);
}
function linkMaterialLines(state: Workspace, p: Page, nodes: readonly EditorNode[], previousNodes: readonly EditorNode[] = nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n])), previousById = new Map(previousNodes.map((n) => [n.id, n]));
  for (const s of p.sections) {
    if (s.kind !== "good-stuffs") continue;
    for (const b of s.blocks) {
      const node = byId.get(b.id), link = lineLink(node, b.text);
      const m = b.kind === "material" ? state.materials.find((m) => m.id === b.materialId) : undefined;
      if (m) {
        if (link && untouchedLineMaterial(m, b.id, previousById.get(b.id))) {
          if (link.url === m.url) { m.title = text(link.title, 1000); continue; }
          const owner = state.materials.find((x) => x.url === link.url);
          if (!owner) { m.url = link.url; m.title = text(link.title, 1000); continue; }
          // The URL is already saved: this line becomes another save of it. `m` carries nothing but the
          // half-typed URL, so it goes rather than leaving a second, empty item in the sort step.
          state.materials = state.materials.filter((x) => x !== m);
          b.materialId = owner.id;
          owner.sources.push({ pageId: p.id, blockId: b.id, note: "" });
          continue;
        }
        const source = m.sources.find((x) => x.blockId === b.id);
        if (source) source.note = text(lineNote(node, b.text, m.url));
        continue;
      }
      if (b.kind !== "paragraph" || !link) continue;
      // Derived from the block, like `editor-task:` ids, so the browser's save preview and the server agree.
      const saved = findOrCreateMaterial(state, p, link.url, link.title, "", `material:${b.id}`);
      b.kind = "material";
      b.materialId = saved.id;
      if (!saved.sources.some((x) => x.blockId === b.id)) saved.sources.push({ pageId: p.id, blockId: b.id, note: "" });
    }
  }
}
const flatNodes = (list: readonly EditorNode[]): EditorNode[] => list.flatMap((n) => [n, ...flatNodes(n.children ?? [])]);
/** Calendar and future-day lists (rule R4): the day's planned tasks, then open tasks only due that day. */
export function getCalendarTasks(state: Workspace, day: string): Task[] {
  const planned = getDayView(state, day).planned;
  const ids = new Set(planned.map((t) => t.id));
  const due = state.tasks.filter((t) => t.status === "open" && !isBlankTask(t) && t.deadlineOn === day && !ids.has(t.id));
  return [...planned, ...due];
}
/**
 * A task whose title is empty after trimming: an empty checkbox row left in a section (Brian's Oct 19 TODO - Other).
 * It stays where he left it, on the page and in the editor, but no task list or count shows it: Today, Open, Paused,
 * Calendar, Upcoming, the hand-off, the morning card, Draft my day, "N other open tasks" (Lead 2f917190 / d5723121,
 * morning-card-build §3). Typing a title makes it a normal task again.
 */
export function isBlankTask(t: Task): boolean {
  return !t.title.trim();
}
export function getDayView(state: Workspace, day: string): DayView {
  date(day);
  const current =
    state.pages.find((p) => p.type === "daily" && p.date === day) ?? null;
  const listed = state.tasks.filter((t) => !isBlankTask(t));
  const planned = listed.filter(
    (t) =>
      t.status === "open" &&
      t.plannedOn === day &&
      !state.placements.some(
        (p) => p.taskId === t.id && p.date === day && p.state === "excluded",
      ),
  );
  planned.sort((a, b) => (state.placements.find(p => p.taskId === a.id && p.date === day)?.order ?? 1e9) - (state.placements.find(p => p.taskId === b.id && p.date === day)?.order ?? 1e9));
  const openPool = listed.filter(
    (t) =>
      t.status === "open" && !t.paused && (!t.plannedOn || t.plannedOn <= day),
  );
  const previous = state.pages
    .filter((p) => p.type === "daily" && p.date! < day)
    .sort((a, b) => b.date!.localeCompare(a.date!))[0];
  const previousIds = new Set(
    state.placements
      .filter((placement) => placement.date === previous?.date && placement.state === 'included')
      .map((placement) => placement.taskId),
  );
  const handoffTasks = openPool.filter(
    (t) => previousIds.has(t.id) && t.plannedOn !== day,
  );
  const handoffIds = new Set(handoffTasks.map((t) => t.id));
  const carry = openPool
    .filter(
      (t) =>
        t.lastPlannedOn &&
        t.lastPlannedOn < day &&
        t.plannedOn !== day &&
        !handoffIds.has(t.id),
    )
    .sort(
      (a, b) =>
        a.lastPlannedOn!.localeCompare(b.lastPlannedOn!) ||
        a.createdOn.localeCompare(b.createdOn) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3);
  // Morning card §5: text and link lines from the previous day's Notes and Good Stuffs, not page cards or events.
  // A line is offered until today holds a copy of it, or once held one: a copy he deleted stays dealt with, and only
  // Undo (which restores the page as it was) offers it again (Jazz e876866a). The record is the copy's block metadata.
  const handoffBlocks =
    previous?.sections
      .filter((s) => s.kind === "notes" || s.kind === "good-stuffs")
      .flatMap((s) => s.blocks.filter((b) => bringable(b) && !(current && wasBrought(current, previous.id, b.id))).map((block) => ({ pageId: previous.id, block }))) ?? [];
  const materialReview = state.materials
    .filter(
      (m) =>
        m.resurface &&
        (!m.skippedUntil || m.skippedUntil <= day) &&
        ((m.reviewState === "pending" && addDays(m.savedOn, 2) <= day) ||
          (m.reviewState === "watching" &&
            !!m.nextReviewOn &&
            m.nextReviewOn <= day)),
    )
    .sort(
      (a, b) =>
        (a.nextReviewOn ?? a.savedOn).localeCompare(
          b.nextReviewOn ?? b.savedOn,
        ) || a.id.localeCompare(b.id),
    )
    .slice(0, 3);
  return {
    page: current,
    planned,
    openPool,
    handoffTasks,
    handoffBlocks,
    carry,
    paused: listed.filter((t) => t.status === "open" && t.paused),
    attention: listed.filter(
      (t) =>
        t.status === "open" &&
        ((!!t.deadlineOn && t.deadlineOn <= day) ||
          (!!t.attentionOn && t.attentionOn <= day)),
    ),
    events: state.events.filter((e) => !e.cancelled && e.date === day),
    materialReview,
  };
}
/**
 * Applies one proposal of a capture and marks it applied. Dates follow their role: do = planned (placed on that day),
 * due = deadline, start = attention. Events need a date; a dated update moves or re-dates the existing task.
 */
function applyProposal(state: Workspace, c: Capture, p: Page, proposal: ProposalItem): void {
  switch (proposal.kind) {
    case "create-task": {
      const role = proposal.date ? proposal.dateRole ?? "do" : null;
      const t = createTask(state, proposal.title, p, null, {
        deadlineOn: role === "due" ? proposal.date : null,
        attentionOn: role === "start" ? proposal.date : null,
      });
      if (role === "do" && proposal.date) place(state, t, proposal.date);
      const blockId = newId();
      appendBlock(p, ensureSection(p, "notes"), { id: blockId, kind: "task", taskId: t.id, text: t.title });
      proposal.blockId = blockId;
      c.taskId ??= t.id;
      proposal.entityId = t.id;
      proposal.appliedVersion = t.version;
      break;
    }
    case "create-event": {
      if (!proposal.date) throw new DomainError("An event needs a date");
      const r = execute(state, { type: "add-event", pageId: p.id, title: proposal.title, date: proposal.date, ...(proposal.time ? { time: proposal.time } : {}) } as Action);
      proposal.entityId = r.entityId;
      break;
    }
    case "add-note": {
      const id = newId();
      appendBlock(p, ensureSection(p, "notes"), { id, kind: "paragraph", text: text(proposal.title) });
      proposal.entityId = id;
      break;
    }
    case "create-material": {
      const m = saveMaterial(state, p, ensureSection(p, "good-stuffs"), proposal.url!, proposal.title, "", proposal.note ?? "");
      proposal.entityId = m.id;
      proposal.blockId = m.sources.at(-1)?.blockId;
      break;
    }
    case "update-task": {
      const t = task(state, proposal.taskId!);
      if (proposal.expectedVersion !== undefined && t.version !== proposal.expectedVersion) throw new DomainError("Task changed; not applied");
      proposal.before = { status: t.status, plannedOn: t.plannedOn, deadlineOn: t.deadlineOn, attentionOn: t.attentionOn, placements: structuredClone(state.placements.filter((x) => x.taskId === t.id)) };
      if (proposal.status) t.status = proposal.status;
      if (proposal.date) {
        // An update's date without a role is a move to that day (Lead 6ea38307).
        const role = proposal.dateRole ?? "do";
        if (role === "do") place(state, t, proposal.date);
        else if (role === "due") t.deadlineOn = proposal.date;
        else t.attentionOn = proposal.date;
      }
      t.version++;
      proposal.entityId = t.id;
      proposal.appliedVersion = t.version;
      break;
    }
  }
  proposal.state = "applied";
  proposal.appliedSnapshot = appliedSnapshot(state, proposal);
}
/**
 * What a saved item looks like right now, where it sits included (page, section, block): compared with the copy taken
 * when this capture saved it, so an edit, a delete or a move made anywhere else blocks Undo all (Ratchet #70, Lead
 * 2d21e087). Tasks and updates also check the task version.
 */
function appliedSnapshot(state: Workspace, proposal: ProposalItem): string {
  const blocks = (match: (b: NoteBlock) => boolean) =>
    state.pages.flatMap((pg) => pg.sections.flatMap((s) => s.blocks.filter(match).map((b) => [pg.id, s.id, b])));
  switch (proposal.kind) {
    case "create-task":
      return JSON.stringify(blocks((b) => b.id === proposal.blockId));
    case "create-event": {
      const e = state.events.find((x) => x.id === proposal.entityId);
      return JSON.stringify([e ?? null, blocks((b) => b.eventId === proposal.entityId)]);
    }
    case "add-note":
      return JSON.stringify(blocks((b) => b.id === proposal.entityId));
    case "create-material": {
      const m = state.materials.find((x) => x.id === proposal.entityId);
      return JSON.stringify([m ? { url: m.url, title: m.title, reviewState: m.reviewState, decisions: m.decisions ?? [] } : null, blocks((b) => b.id === proposal.blockId)]);
    }
    case "update-task":
      return "";
  }
}
/** Refuses when something this capture saved has been changed, deleted or moved since, anywhere. */
function assertUnchangedSince(state: Workspace, proposal: ProposalItem): void {
  if (proposal.kind === "create-task" || proposal.kind === "update-task") {
    const t = state.tasks.find((x) => x.id === proposal.entityId);
    if (!t || t.version !== proposal.appliedVersion) throw new DomainError("Can't undo · edited since");
  }
  if (proposal.appliedSnapshot !== undefined && appliedSnapshot(state, proposal) !== proposal.appliedSnapshot) throw new DomainError("Can't undo · edited since");
}
/**
 * A field edit on a saved task, event or note changes it where it is: same id, same rows, same place (Ratchet #70).
 * Only a type change replaces it. The item must be unchanged since it was saved.
 */
function editAppliedInPlace(state: Workspace, item: ProposalItem): void {
  const blocksOf = (match: (b: NoteBlock) => boolean) => state.pages.flatMap((pg) => pg.sections.flatMap((s) => s.blocks.filter(match)));
  switch (item.kind) {
    case "create-task": {
      const t = task(state, item.entityId!);
      t.title = item.title;
      for (const b of blocksOf((b) => b.kind === "task" && b.taskId === t.id)) b.text = t.title;
      // The task is as this capture left it, so its dates can be set afresh from the item.
      const role = item.date ? item.dateRole ?? "do" : null;
      state.placements = state.placements.filter((x) => x.taskId !== t.id);
      for (const pg of state.pages) for (const s of pg.sections)
        if (s.kind === "top3" || s.kind === "other") s.blocks = s.blocks.filter((b) => !(b.kind === "task" && b.taskId === t.id));
      Object.assign(t, { plannedOn: null, lastPlannedOn: null, deadlineOn: role === "due" ? item.date : null, attentionOn: role === "start" ? item.date : null });
      if (role === "do" && item.date) place(state, t, item.date);
      t.version++;
      item.appliedVersion = t.version;
      break;
    }
    case "create-event": {
      if (!item.date) throw new DomainError("An event needs a date");
      const e = requireValue(state.events.find((x) => x.id === item.entityId), "Event");
      Object.assign(e, { title: text(item.title, 1000), date: date(item.date), time: item.time ?? null });
      for (const b of blocksOf((b) => b.eventId === e.id)) b.text = e.title;
      break;
    }
    case "add-note":
      for (const b of blocksOf((b) => b.id === item.entityId)) b.text = text(item.title);
      break;
  }
  item.appliedSnapshot = appliedSnapshot(state, item);
}
/** Receipt v2: takes back one item this capture saved, only if nothing has changed it since ("Can't undo · edited since"). */
function removeApplied(state: Workspace, proposal: ProposalItem): void {
  assertUnchangedSince(state, proposal);
  const id = proposal.entityId;
  const dropBlocks = (match: (b: NoteBlock) => boolean) => { for (const pg of state.pages) for (const s of pg.sections) s.blocks = s.blocks.filter((b) => !match(b)); };
  switch (proposal.kind) {
    case "create-task": {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) break;
      if (t.version !== proposal.appliedVersion) throw new DomainError("Can't undo · edited since");
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      state.placements = state.placements.filter((x) => x.taskId !== t.id);
      dropBlocks((b) => b.taskId === t.id);
      break;
    }
    case "create-event": {
      state.events = state.events.filter((x) => x.id !== id);
      dropBlocks((b) => b.eventId === id);
      break;
    }
    case "add-note":
      dropBlocks((b) => b.id === id);
      break;
    case "create-material": {
      const m = state.materials.find((x) => x.id === id);
      dropBlocks((b) => b.id === proposal.blockId);
      if (!m) break;
      m.sources = m.sources.filter((x) => x.blockId !== proposal.blockId);
      // A link first saved by this capture, with nothing done to it since, goes; an older one just loses this save.
      if (!m.sources.length && m.reviewState === "pending" && !(m.decisions ?? []).length) state.materials = state.materials.filter((x) => x !== m);
      break;
    }
    case "update-task": {
      const t = state.tasks.find((x) => x.id === id);
      if (!t || !proposal.before) break;
      if (t.version !== proposal.appliedVersion) throw new DomainError("Can't undo · edited since");
      Object.assign(t, { status: proposal.before.status, plannedOn: proposal.before.plannedOn, deadlineOn: proposal.before.deadlineOn, attentionOn: proposal.before.attentionOn });
      state.placements = state.placements.filter((x) => x.taskId !== t.id).concat(structuredClone(proposal.before.placements));
      t.version++;
      delete proposal.before;
      break;
    }
  }
  delete proposal.entityId;
  delete proposal.state;
}
/** A capture is waiting while any item waits, saved once every item is saved or removed, discarded if all were removed. */
function settleCaptureStatus(c: Capture): void {
  const items = c.proposals ?? [];
  c.status = items.some((x) => !x.state) ? "needs_confirmation" : items.some((x) => x.state === "applied") ? "applied" : "discarded";
  c.proposalRevision++;
}
/** A4: a trashed page is read-only until restored, and nothing can be put under it or point at it anew. */
function refuseTrashedTarget(state: Workspace, action: Action | ServerAction): void {
  if (action.type === "restore-page" || action.type === "restore-batch") return;
  const a = action as { pageId?: unknown; parentId?: unknown; targetPageId?: unknown };
  for (const id of [a.pageId, a.parentId, a.targetPageId])
    if (typeof id === "string" && state.pages.some((p) => p.id === id && isTrashed(p))) throw new DomainError("Page is in trash; restore it first");
}
/**
 * A4: bring back `ids` (members of one delete). A restored page whose parent isn't coming back with it goes under that
 * parent if it's live, otherwise to top level (a parent still in the trash, or gone). Its place in the stored order is
 * kept; sibling order isn't promised until B14.
 */
function restorePages(state: Workspace, ids: Set<string>): { pages: Page[]; toTopLevel: Page[] } {
  const pages = state.pages.filter((p) => ids.has(p.id));
  const toTopLevel: Page[] = [];
  for (const p of pages) {
    delete p.trashedAt;
    delete p.trashId;
  }
  for (const p of pages) {
    if (!p.parentId || ids.has(p.parentId)) continue;
    const parent = state.pages.find((x) => x.id === p.parentId);
    if (!parent || isTrashed(parent)) {
      delete p.parentId;
      toTopLevel.push(p);
    }
  }
  return { pages, toTopLevel };
}
function execute(
  state: Workspace,
  action: Action | ServerAction,
  operationId: string = newId(),
): { message: string; entityId?: string; simulated?: boolean } {
  refuseTrashedTarget(state, action);
  switch (action.type) {
    case "save-editor": {
      const p = page(state, action.pageId);
      for (const [id, expected] of Object.entries(action.historyTaskVersions ?? {})) {
        const current = state.tasks.find(t => t.id === id);
        if ((current?.version ?? 0) !== expected) throw new DomainError(`Can't undo: '${current?.title ?? 'Task'}' changed since`);
      }
      if (pageContentKey(p) !== action.expectedContent) throw new DomainError("Page changed elsewhere. Your editor draft is kept; reload or copy it before resolving.");
      const nodes = JSON.parse(action.document);
      if (!Array.isArray(nodes) || nodes.length > 5000) throw new DomainError("Invalid editor document");
      const flat = (list: any[]): any[] => list.flatMap(n => [n, ...flat(n.children ?? [])]);
      const all = flat(nodes);
      const pastedChecklists = new Set(flat(JSON.parse(p.editorJSON ?? '[]')).filter(n => n.type === 'sourceChecklist').map(n => n.id));
      const present = new Set(all.map(n => n.id));
      if (action.history) for (const [blockId, taskId] of Object.entries(p.editorCreations ?? {})) {
        const wasPresent = p.sections.some(s => s.blocks.some(b => b.id === blockId));
        if (!wasPresent || present.has(blockId) && all.find(n => n.id === blockId)?.type === 'task' && inlineText(all.find(n => n.id === blockId)?.content)) continue;
        const otherReferences = state.pages.some(other => other.sections.some(s => s.blocks.some(b => b.taskId === taskId && (other.id !== p.id || b.id !== blockId))));
        if (otherReferences) throw new DomainError("Can't undo: new task is referenced elsewhere");
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        state.placements = state.placements.filter(x => x.taskId !== taskId);
      }
      // Undo of a semantic row deletion restores only its checked task and relations.
      for (const [blockId, effect] of Object.entries(p.editorDeletions ?? {})) {
        if (!present.has(blockId)) continue;
        const current = task(state, effect.task.id);
        if (current.version !== effect.afterVersion || JSON.stringify(state.placements.filter(x => x.taskId === current.id)) !== JSON.stringify(effect.afterPlacements)) throw new DomainError("Task changed after deletion; cannot undo safely");
        Object.assign(current, effect.task, { version: current.version + 1 });
        state.placements = state.placements.filter(x => x.taskId !== current.id).concat(effect.placements);
        delete p.editorDeletions![blockId];
      }
      const previousBlocks = p.sections.flatMap(s => s.blocks);
      p.editorBlockMetadata ??= {};
      for (const block of previousBlocks) p.editorBlockMetadata[block.id] = structuredClone(block);
      for (const node of all) {
        if (node.type !== 'task' || state.tasks.some(t => t.id === node.props?.taskId)) continue;
        if (!inlineText(node.content) && node.props?.taskId === `editor-task:${node.id}`) continue;
        const existingContent = previousBlocks.some(b => b.id === node.id && (b.kind !== 'paragraph' || b.text));
        // Only an imported checklist can become a Task while retaining a non-empty existing block ID.
        const checklistConversion = pastedChecklists.has(node.id) && (node.props?.role === 'reference' || node.props?.role === 'plan' && Boolean(p.date));
        if (node.props?.taskId !== `editor-task:${node.id}` || existingContent && !checklistConversion) throw new DomainError("Unknown Task identity");
        const planned = node.props.role === 'plan' ? p.date : null;
        const t = createTask(state, inlineText(node.content) || 'Untitled task', p, planned);
        t.id = node.props.taskId;
        t.title = inlineText(node.content);
        (p.editorCreations ??= {})[node.id] = t.id;
        if (planned) place(state, t, planned);
      }
      for (const singleDeleteId of action.singleDeleteIds ?? []) {
       if (!present.has(singleDeleteId) && p.date === action.today) {
        const b = previousBlocks.find(b => b.id === singleDeleteId);
        const isPlan = b?.planRole === 'plan' || b?.planRole === undefined && p.sections.some(s => (s.kind === 'top3' || s.kind === 'other') && s.blocks.some(x => x.id === b?.id));
        if (b?.taskId && isPlan) {
          const t = task(state, b.taskId);
          if (t.plannedOn === p.date) {
            const beforeTask = structuredClone(t), beforePlacements = structuredClone(state.placements.filter(x => x.taskId === t.id));
            pause(state, t, p.date!);
            (p.editorDeletions ??= {})[b.id] = { task: beforeTask, placements: beforePlacements, afterVersion: t.version, afterPlacements: structuredClone(state.placements.filter(x => x.taskId === t.id)) };
          }
        }
      }
      }
      p.sections = projectDocument(nodes, p, state);
      linkMaterialLines(state, p, all, flat(JSON.parse(p.editorJSON ?? "[]")));
      const ordered = p.sections.flatMap(s => s.blocks).filter(b => b.kind === 'task' && b.planRole === 'plan');
      ordered.forEach((b, order) => {
        const relation = state.placements.find(x => x.taskId === b.taskId && x.date === p.date && x.state === 'included');
        if (relation) relation.order = order;
      });
      p.editorJSON = action.document;
      p.templateApplied = true;
      p.editorSections = JSON.stringify(p.sections);
      return { message: "Page saved; task arrangements unchanged" };
    }

    case "bring-line": {
      // Morning card §5: a line from the previous day's Notes or Good Stuffs is copied into the same-named section of
      // the day's page (or Notes), through save-editor like typing, so tags and the Good Stuffs material rule apply.
      // The copy keeps its source, so the line isn't offered again. The source line is never changed.
      const p = state.pages.find((x) => x.type === "daily" && x.date === date(action.date));
      if (!p) throw new DomainError("Page not found");
      const source = page(state, action.sourcePageId);
      const from = source.sections.find((s) => s.blocks.some((b) => b.id === action.sourceBlockId));
      const block = from?.blocks.find((b) => b.id === action.sourceBlockId);
      if (!from || !block) throw new DomainError("Line not found");
      if (!bringable(block)) throw new DomainError("Only text lines can be brought");
      if (wasBrought(p, source.id, block.id)) throw new DomainError("Already brought");
      const doc = editorSeed(p, state, { templateRows: needsTemplateRows(p, action.date) });
      const sourceNode = flatNodes(JSON.parse(source.editorJSON ?? "[]")).find((n) => n.id === block.id);
      const copyId = newId();
      // The line's own inline content (links, marks) when the editor saved it; otherwise its text.
      const copy: EditorNode = { id: copyId, type: sourceNode && ["paragraph", "bulletListItem", "numberedListItem"].includes(sourceNode.type) ? sourceNode.type : "paragraph", content: sourceNode?.content ?? block.text };
      const sameName = (t: string) => t.trim().toLowerCase() === from.title.trim().toLowerCase();
      const heading = doc.find((n) => n.type === "heading" && from.title.trim() && sameName(inlineText(n.content)))
        ?? doc.find((n) => n.type === "heading" && p.sections.find((s) => s.id === n.id)?.kind === "notes")
        ?? doc.find((n) => n.type === "heading" && inlineText(n.content).trim().toLowerCase() === "notes");
      if (heading) {
        // After the section's last line with text, so its empty starter row stays last for typing.
        const range = sectionRange(doc, heading.id);
        let at = doc.indexOf(range.at(-1)!);
        while (at > doc.indexOf(heading) && !inlineText(doc[at]!.content).trim() && !doc[at]!.children?.length && doc[at]!.type !== "task" && doc[at]!.type !== "pageLink") at--;
        doc.splice(at + 1, 0, copy);
      } else doc.push({ id: newId(), type: "heading", props: { level: 2 }, content: "Notes" }, copy);
      (p.editorBlockMetadata ??= {})[copyId] = { id: copyId, kind: "paragraph", text: block.text, sourcePageId: source.id, sourceBlockId: block.id };
      execute(state, { type: "save-editor", pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) });
      const target = p.sections.find((s) => s.blocks.some((b) => b.id === copyId))!;
      return { message: `Brought to ${target.title || "today"}`, entityId: copyId };
    }
    case "ensure-day": {
      const p = ensureDay(state, action.date);
      return { message: "Day opened", entityId: p.id };
    }
    case "add-section": {
      const p = page(state, action.pageId);
      const s: Section = {
        id: newId(),
        kind: "custom",
        title: text(action.title, 1000),
        blocks: [],
      };
      p.sections.push(s);
      return { message: "Section added", entityId: s.id };
    }
    case "rename-section": {
      section(page(state, action.pageId), action.sectionId).title = text(
        action.title,
        1000,
      );
      return { message: "Section saved" };
    }
    case "remove-section": {
      const p = page(state, action.pageId);
      section(p, action.sectionId);
      p.sections = p.sections.filter((s) => s.id !== action.sectionId);
      return { message: "Section removed; task arrangements unchanged" };
    }
    case "add-text": {
      const p = page(state, action.pageId),
        s = section(p, action.sectionId);
      const value = text(action.text);
      if (s.kind === "good-stuffs" && /^https?:\/\/\S+$/.test(value.trim())) {
        const m = saveMaterial(state, p, s, value.trim(), value.trim());
        return {
          message: "Link saved; no source text fetched",
          entityId: m.id,
        };
      }
      const b: NoteBlock = { id: newId(), kind: "paragraph", text: value };
      appendBlock(p, s, b);
      return { message: "Text saved", entityId: b.id };
    }
    case "edit-block": {
      const p = page(state, action.pageId);
      const b = requireValue(
        p.sections
          .flatMap((s) => s.blocks)
          .find((b) => b.id === action.blockId),
        "Block",
      );
      b.text = text(action.text);
      if (b.taskId) {
        const t = task(state, b.taskId);
        if (!action.text.trim()) throw new DomainError("Task title is empty");
        t.title = text(action.text, 1000);
        t.version++;
      }
      return { message: "Text saved; dates unchanged" };
    }
    case "remove-blocks": {
      const p = page(state, action.pageId);
      const ids = new Set(action.blockIds);
      const blocks = p.sections
        .flatMap((s) => s.blocks)
        .filter((b) => ids.has(b.id));
      if (blocks.length !== ids.size) throw new DomainError("Block not found");
      const planBlock =
        !action.bulk &&
        blocks.length === 1 &&
        p.date === action.today &&
        p.sections.some(
          (s) =>
            (s.kind === "top3" || s.kind === "other") &&
            s.blocks.some((b) => b.id === blocks[0]!.id),
        )
          ? blocks[0]
          : undefined;
      if (
        planBlock?.taskId &&
        task(state, planBlock.taskId).plannedOn === action.today
      ) {
        pause(state, task(state, planBlock.taskId), action.today);
        return {
          message: "Not today — carry-over stopped; deadline kept · Undo",
        };
      }
      for (const s of p.sections)
        s.blocks = s.blocks.filter((b) => !ids.has(b.id));
      return {
        message: "Page content removed; task arrangements unchanged · Undo",
      };
    }
    case "add-task": {
      const p = page(state, action.pageId),
        s = section(p, action.sectionId);
      const t = createTask(
        state,
        action.title,
        p,
        action.plannedOn === undefined ? p.date : action.plannedOn,
        action,
      );
      appendBlock(p, s, { id: newId(), kind: "task", taskId: t.id, text: t.title });
      if (t.plannedOn)
        place(state, t, t.plannedOn, s.kind === "top3" ? "top3" : "other");
      return { message: "Task saved", entityId: t.id };
    }
    case "task-status": {
      const t = task(state, action.taskId);
      if (!["open", "done", "cancelled"].includes(action.status))
        throw new DomainError("Invalid task status");
      t.status = action.status;
      t.version++;
      return { message: `Task ${action.status}`, entityId: t.id };
    }
    case "plan-task": {
      const t = task(state, action.taskId);
      if (t.status !== "open")
        throw new DomainError("Restore task before planning");
      place(state, t, action.date, action.section);
      return { message: `Planned for ${action.date}`, entityId: t.id };
    }
    case "plan-tasks": {
      // Morning card "Add all tasks": every row to its own section in one operation, so its Undo is whole. A full
      // Top 3 sends the rest to the plan list, as one + would.
      const ids = new Set<string>();
      for (const item of action.items) {
        const t = task(state, item.taskId);
        if (t.status !== "open") throw new DomainError("Restore task before planning");
        if (ids.has(t.id)) throw new DomainError("Task listed twice");
        ids.add(t.id);
        place(state, t, action.date, item.section === "top3" && top3Full(state, action.date) ? "other" : item.section);
      }
      return { message: `Added ${action.items.length} tasks` };
    }
    case "not-today": {
      pause(state, task(state, action.taskId), action.date);
      return {
        message: "Not today — carry-over stopped; deadline kept · Undo",
        entityId: action.taskId,
      };
    }
    case "add-event": {
      const p = page(state, action.pageId);
      date(action.date);
      if (action.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.time))
        throw new DomainError("Invalid time");
      const e = {
        id: newId(),
        title: text(action.title, 1000),
        date: action.date,
        time: action.time ?? null,
        cancelled: false,
      };
      state.events.push(e);
      appendBlock(p, ensureSection(p, "events"), {
        id: newId(),
        kind: "event",
        eventId: e.id,
        text: e.title,
      });
      return { message: "Event saved", entityId: e.id };
    }
    case "keep-block": {
      const source = page(state, action.sourcePageId);
      const sourceSection = requireValue(
        source.sections.find((s) =>
          s.blocks.some((b) => b.id === action.blockId),
        ),
        "Source section",
      );
      const b = requireValue(
        sourceSection.blocks.find((b) => b.id === action.blockId),
        "Source block",
      );
      const target = ensureDay(state, action.targetDate);
      if (b.taskId) {
        place(state, task(state, b.taskId), action.targetDate);
        return { message: "Same task kept for today", entityId: b.taskId };
      }
      const old = target.sections
        .flatMap((s) => s.blocks)
        .find(
          (copy) =>
            copy.sourcePageId === source.id && copy.sourceBlockId === b.id,
        );
      if (old)
        return { message: "Already brought to this day", entityId: old.id };
      const copy = {
        ...structuredClone(b),
        id: newId(),
        sourcePageId: source.id,
        sourceBlockId: b.id,
      };
      appendBlock(target, ensureSection(target, sourceSection.kind), copy);
      return { message: "Brought to this day with source", entityId: copy.id };
    }
    case "handoff-done": {
      ensureDay(state, action.date).handoffDone = true;
      return { message: "Morning hand-off saved" };
    }
    case "save-review": {
      const p = ensureDay(state, action.date);
      p.reviewText = text(action.text);
      if (action.finish) p.reviewSaved = true;
      return {
        message: action.finish ? "Review saved" : "Review progress saved",
      };
    }
    case "review-progress": {
      const p = ensureDay(state, action.date);
      p.reviewStep = action.step;
      p.reviewSource = action.source ?? p.reviewSource ?? "direct";
      p.reviewSkipped = action.skip ?? false;
      return {
        message: action.skip
          ? "Review skipped tonight"
          : "Review progress saved",
      };
    }
    case "save-material": {
      const p = page(state, action.pageId);
      const m = saveMaterial(
        state,
        p,
        section(p, action.sectionId),
        action.url,
        action.title,
        action.body,
        action.note,
      );
      return { message: "Material saved", entityId: m.id };
    }
    case "review-material": {
      const m = material(state, action.materialId);
      date(action.date);
      if (action.nextReviewOn && action.nextReviewOn <= action.date)
        throw new DomainError("Return date must be in the future");
      m.lastDecisionOn = action.date;
      m.skippedUntil = null;
      if (action.decision === "task") {
        if (!m.taskId) {
          const p = ensureDay(state, action.date),
            t = createTask(state, m.title, p, null);
          m.taskId = t.id;

        }
        m.reviewState = "task";
        m.nextReviewOn = null;
      } else {
        m.reviewState = action.decision;
        m.nextReviewOn =
          action.decision === "watching"
            ? action.nextReviewOn
              ? date(action.nextReviewOn)
              : addDays(action.date, 7)
            : null;
      }
      m.decisions = [
        ...(m.decisions ?? []),
        { date: action.date, decision: action.decision },
      ];
      return {
        message:
          action.decision === "task"
            ? "Task created · Unscheduled · Open"
            : "Saved-item choice saved · Undo",
        entityId: m.taskId ?? m.id,
      };
    }
    case "skip-material-review": {
      date(action.date);
      for (const id of new Set(action.materialIds))
        material(state, id).skippedUntil = addDays(action.date, 3);
      return { message: "Shown cards skipped for three days" };
    }
    case "material-resurface": {
      material(state, action.materialId).resurface = action.enabled;
      return {
        message: action.enabled
          ? "May resurface again"
          : "Saved; will not resurface",
      };
    }
    case "open-material": {
      const m = material(state, action.materialId);
      m.openedOn = [...(m.openedOn ?? []), date(action.date)];
      return { message: "Material opened", entityId: m.id };
    }
    case "dismiss-material": {
      const m = material(state, action.materialId);
      m.dismissedOn = [
        ...new Set([...(m.dismissedOn ?? []), date(action.date)]),
      ];
      return { message: "Suggestion dismissed for this day" };
    }
    case "create-document": {
      // `/page` picks the id in the browser so the card can be inserted at once; a retry under a new operation
      // id finds the same page instead of making a second one.
      const id = action.pageId ?? newId();
      const existing = state.pages.find((p) => p.id === id);
      if (existing) {
        if (existing.type !== "document" || (existing.parentId ?? null) !== (action.parentId ?? null)) throw new DomainError("Page id already in use");
        return { message: "Page saved", entityId: id };
      }
      if (action.parentId) page(state, action.parentId);
      state.pages.push({
        id,
        type: "document",
        date: null,
        title: text(action.title, 1000),
        ...(action.parentId ? { parentId: action.parentId } : {}),
        // A subpage starts as one empty line, like Notion; Pages → New keeps its Notes heading.
        sections: action.parentId
          ? [{ id: `intro:${id}`, kind: "custom", title: "", blocks: [{ id: newId(), kind: "paragraph", text: text(action.body) }] }]
          : [
          {
            id: newId(),
            kind: "notes",
            title: "Notes",
            blocks: [
              { id: newId(), kind: "paragraph", text: text(action.body) },
            ],
          },
        ],
        reviewText: "",
        reviewSaved: false,
        handoffDone: false,
        draft: null,
      });
      return { message: "Page saved", entityId: id };
    }
    case "rename-page": {
      const p = page(state, action.pageId);
      if (p.type !== "document") throw new DomainError("Day pages are named by their date");
      p.title = text(action.title, 1000).trim();
      return { message: "Page renamed", entityId: p.id };
    }
    case "move-page": {
      // N-2: the page keeps its id, so every card and Linked from entry stays valid; it goes to the end of its new
      // siblings. References are untouched. Undo is the generic one.
      const refusal = moveRefusal(state, action.pageId, action.parentId);
      if (refusal) throw new DomainError(refusal);
      const index = state.pages.findIndex((p) => p.id === action.pageId);
      const [moved] = state.pages.splice(index, 1);
      if (action.parentId) moved!.parentId = action.parentId;
      else delete moved!.parentId;
      state.pages.push(moved!);
      return { message: action.parentId ? "Page moved" : "Moved to top level", entityId: moved!.id };
    }
    case "delete-page": {
      // A4 (plan a4-trash-data §2): the page and every live descendant go to the trash as one batch, the delete's
      // operation id. Pages trashed earlier keep their own batch. Nothing else changes: tasks, materials, references.
      const p = page(state, action.pageId);
      if (p.type !== "document") throw new DomainError("Day pages can't be deleted");
      if (!Number.isFinite(Date.parse(action.at))) throw new DomainError("Invalid time");
      const ids = subtreeIds(state, p.id);
      const members = state.pages.filter((x) => ids.has(x.id) && !isTrashed(x));
      for (const x of members) {
        x.trashedAt = action.at;
        x.trashId = operationId;
      }
      const n = members.length - 1;
      return { message: n ? `Moved to trash · ${n} subpage${n === 1 ? "" : "s"}` : "Moved to trash", entityId: p.id };
    }
    case "restore-page": {
      // A4: the page plus those of its descendants still in the same batch (pages-trash-layout §4).
      const p = page(state, action.pageId);
      if (!isTrashed(p)) throw new DomainError("Page is not in trash");
      const ids = new Set([p.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const x of state.pages)
          if (isTrashed(x) && x.trashId === p.trashId && x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
      }
      const { toTopLevel } = restorePages(state, ids);
      return { message: toTopLevel.length ? "Restored to Pages" : "Restored", entityId: p.id };
    }
    case "restore-batch": {
      // A4: what's left of a delete; pages restored earlier stay where they are now.
      const ids = new Set(state.pages.filter((x) => isTrashed(x) && x.trashId === action.trashId).map((x) => x.id));
      if (!ids.size) throw new DomainError("Nothing left to restore");
      const { pages, toTopLevel } = restorePages(state, ids);
      const top = pages.find((x) => !x.parentId || !ids.has(x.parentId))!;
      return { message: toTopLevel.includes(top) ? "Restored to Pages" : "Restored", entityId: top.id };
    }
    case "start-draft-run": {
      // A6b plan §3: a real run of Draft my day, bound to the operation that started it (runId). Refused while one is
      // drafting or the day already has a draft; allowed again after a failure (Retry is a new paid attempt).
      const p = ensureDay(state, action.date);
      if (hasDayDraft(p)) throw new DomainError(p.draft?.run?.status === "drafting" ? "Already drafting" : "Today already has a draft");
      const run = (p.draft?.run?.run ?? 0) + 1;
      p.draft = {
        simulated: false, taskIds: [], materialIds: [], text: "",
        run: { runId: operationId, run, trigger: "card", startedAt: action.startedAt, status: "drafting", attemptId: `draft:${action.date}:${operationId}`, model: action.model, requestHash: "", manifest: { lines: [], sentPages: [], omittedPages: [], taskCandidates: [], materialCandidates: [] } },
        proposals: [], hidden: [],
      };
      delete p.draftError;
      return { message: "Drafting your day", entityId: operationId };
    }
    case "record-draft-request": {
      const p = draftingPage(state, action.date, action.runId);
      p.draft!.run!.requestHash = action.requestHash;
      p.draft!.run!.manifest = action.manifest;
      return { message: "Draft request recorded" };
    }
    case "set-model-draft": {
      // Applies only to the run still drafting under this runId: a late answer after Retry, expiry, Done or a new day
      // is refused here and only its cost is settled (plan §4). Ids outside the manifest never get in.
      const p = draftingPage(state, action.date, action.runId);
      const run = p.draft!.run!, m = run.manifest;
      const lines = new Set(m.lines.map((l) => l.lineId));
      if (action.taskIds.some((id) => !m.taskCandidates.includes(id)) || action.materialIds.some((id) => !m.materialCandidates.includes(id)) || action.proposals.some((x) => !lines.has(x.lineId)))
        throw new DomainError("Draft result points outside what was sent");
      p.draft = { ...p.draft!, taskIds: action.taskIds.slice(0, 3), materialIds: action.materialIds.slice(0, 2), proposals: action.proposals, run: { ...run, status: "ready" } };
      return { message: "Day drafted" };
    }
    case "model-draft-failed": {
      const p = draftingPage(state, action.date, action.runId);
      p.draft!.run = { ...p.draft!.run!, status: action.expired ? "expired" : "failed", failure: action.failure, ...(action.costUnknown ? { costUnknown: true } : {}) };
      p.draftError = draftFailureLine[action.failure];
      return { message: p.draftError };
    }
    case "add-proposal": {
      // A6b plan §4: a new task from his line, word for word, in the plan list (never Top 3), recorded on its row like a
      // brought line. Refused when the line changed, went, moved under another day or was already carried forward.
      const p = state.pages.find((x) => x.type === "daily" && x.date === date(action.date));
      const prop = p?.draft?.proposals?.find((x) => x.lineId === action.lineId);
      if (!p || !prop || p.draft!.hidden?.includes(prop.lineId)) throw new DomainError("Suggestion not found");
      const live = liveProposal(state, prop);
      if (!live) throw new DomainError("This line changed; nothing was added");
      const t = createTask(state, live.block.text, live.page, null);
      t.createdOn = action.date;
      const source = { sourcePageId: live.page.id, sourceBlockId: live.block.id, sourceFingerprint: prop.fingerprint };
      // A dated proposal is planned for its day, like a dated capture: no row on the drafted day's page (Bumblebee,
      // Lead, Ratchet #80). Its accepted record still lives on the drafted day's page, in block metadata under the
      // task's id, so the line stays linked even before that day's page exists.
      if (prop.date && prop.date > action.date) {
        place(state, t, prop.date, "other");
        (p.editorBlockMetadata ??= {})[`accepted:${t.id}`] = { id: `accepted:${t.id}`, kind: "task", taskId: t.id, text: t.title, ...source };
        return { message: `Added for ${prop.date}`, entityId: t.id };
      }
      place(state, t, action.date, "other");
      const row = p.sections.flatMap((s) => s.blocks).find((b) => b.kind === "task" && b.taskId === t.id)!;
      Object.assign(row, source);
      (p.editorBlockMetadata ??= {})[row.id] = structuredClone(row);
      const section = p.sections.find((s) => s.blocks.includes(row))!;
      return { message: `Added to ${section.title || "the plan"}`, entityId: t.id };
    }
    case "hide-proposal": {
      const p = state.pages.find((x) => x.type === "daily" && x.date === date(action.date));
      if (!p?.draft?.proposals?.some((x) => x.lineId === action.lineId)) throw new DomainError("Suggestion not found");
      p.draft.hidden = [...new Set([...(p.draft.hidden ?? []), action.lineId])];
      return { message: "Hidden for today" };
    }
    case "relink-material-lines": {
      // One-off repair for pages written while the editor skipped the material rule; safe to repeat.
      const before = JSON.stringify([state.materials, state.pages]), count = state.materials.length;
      for (const p of state.pages) linkMaterialLines(state, p, flatNodes(JSON.parse(p.editorJSON ?? "[]")));
      // Writing nothing keeps the revision, so a tab Brian has open doesn't see "Page changed elsewhere".
      if (JSON.stringify([state.materials, state.pages]) === before) throw new DomainError("No unsaved Good Stuffs links; nothing written");
      const added = state.materials.length - count;
      return { message: `Saved ${added} link${added === 1 ? "" : "s"} from Good Stuffs` };
    }
    case "insert-reference": {
      const p = page(state, action.pageId),
        target = page(state, action.targetPageId);
      const b: NoteBlock = {
        id: newId(),
        kind: "reference",
        targetPageId: target.id,
        text: target.title,
      };
      appendBlock(p, section(p, action.sectionId), b);
      return { message: "Page reference saved", entityId: b.id };
    }
    case "capture": {
      const p = page(state, action.pageId);
      text(action.text);
      const id = newId();
      const failure =
        action.outcome && action.outcome !== "success"
          ? action.outcome
          : undefined;
      const proposals: ProposalItem[] = /^https?:\/\/\S+$/.test(
        action.text.trim(),
      )
        ? [
            {
              id: newId(),
              kind: "create-material" as const,
              title: action.text.trim(),
              url: action.text.trim(),
            },
          ]
        : [
            {
              id: newId(),
              kind: "create-task" as const,
              title: action.text.trim(),
            },
          ];
      if (action.updateTaskId) {
        const t = task(state, action.updateTaskId);
        proposals.push({
          id: newId(),
          kind: "update-task",
          title: t.title,
          taskId: t.id,
          expectedVersion: t.version,
          status: "done",
        });
      }
      state.captures.push({
        id,
        pageId: p.id,
        text: action.text,
        status: failure ? "failed" : "needs_confirmation",
        proposalRevision: 1,
        simulated: true,
        proposedTitle: action.text.trim(),
        proposals,
        failure,
        error: failure
          ? `Simulated ${failure}; original text saved`
          : undefined,
        contextLine: "Simulated provider · no network request · no charge",
      });
      if (!failure && !action.updateTaskId) {
        execute(state, {type: "apply-capture", captureId: id, proposalRevision: 1});
        return {message: "Simulated new item saved · Undo · no model called", entityId: id, simulated: true};
      }
      return {
        message: failure
          ? `Simulated ${failure}; text saved`
          : "Simulated proposal — review before applying; no model called",
        entityId: id,
        simulated: true,
      };
    }
    case "edit-capture": {
      const c = requireValue(
        state.captures.find((c) => c.id === action.captureId),
        "Capture",
      );
      if (
        c.status !== "needs_confirmation" ||
        c.proposalRevision !== action.proposalRevision
      )
        throw new DomainError("Capture proposal changed");
      c.proposedTitle = text(action.title, 1000);
      if (action.removeItemId)
        c.proposals = c.proposals?.filter((p) => p.id !== action.removeItemId);
      else if (c.proposals?.[0]) c.proposals[0].title = c.proposedTitle;
      c.proposalRevision++;
      return {
        message: "Simulated proposal edited; still waiting for Apply",
        simulated: true,
      };
    }
    case "discard-capture": {
      const c = requireValue(
        state.captures.find((c) => c.id === action.captureId),
        "Capture",
      );
      if (c.status === "applied")
        throw new DomainError("Capture already applied");
      c.status = "discarded";
      return {
        message: "Proposal discarded; original text kept",
        simulated: true,
      };
    }
    case "apply-capture": {
      const c = requireValue(
        state.captures.find((c) => c.id === action.captureId),
        "Capture",
      );
      if (c.status === "applied")
        return {
          message: "Already applied",
          entityId: c.taskId,
          simulated: c.simulated,
        };
      if (
        c.status !== "needs_confirmation" ||
        c.proposalRevision !== action.proposalRevision
      )
        throw new DomainError("Capture proposal changed");
      const p = page(state, c.pageId);
      const waiting = (c.proposals ?? []).filter((x) => !x.state);
      for (const proposal of waiting)
        if (
          proposal.kind === "update-task" &&
          task(state, proposal.taskId!).version !== proposal.expectedVersion
        )
          throw new DomainError("Task changed; mixed group not applied");
      for (const proposal of waiting) applyProposal(state, c, p, proposal);
      c.status = "applied";
      return {
        message: c.simulated
          ? "Simulated proposal applied; new tasks are unscheduled"
          : "Saved",
        entityId: c.taskId,
        simulated: c.simulated,
      };
    }
    // ---- Receipt v2 (Jazz 283697c): fix one item of a capture ----
    case "edit-capture-item": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      const item = requireValue(c.proposals?.find((x) => x.id === action.itemId), "Capture item");
      if (item.state === "removed") throw new DomainError("Item was removed");
      if (item.kind === "update-task" || item.kind === "create-material") {
        if (action.kind) throw new DomainError("This item's type can't change here");
      }
      const p = page(state, c.pageId);
      const wasApplied = item.state === "applied";
      // A saved item is changed where it is; only a type change (or a link) replaces it, and the receipt row stays one row.
      const inPlace = wasApplied && (!action.kind || action.kind === item.kind) && (item.kind === "create-task" || item.kind === "create-event" || item.kind === "add-note");
      if (wasApplied && item.kind !== "update-task") assertUnchangedSince(state, item);
      if (wasApplied && !inPlace && item.kind !== "update-task") removeApplied(state, item);
      if (action.title !== undefined) { item.title = text(action.title, 1000).trim(); item.flags = item.flags?.filter((f) => f !== "title-not-grounded"); }
      if (action.kind) item.kind = action.kind;
      if (action.date !== undefined) { if (action.date) date(action.date); item.date = action.date; item.flags = item.flags?.filter((f) => f !== "date-missing" && f !== "date-role-missing"); }
      if (action.dateRole) { item.dateRole = action.dateRole; item.flags = item.flags?.filter((f) => f !== "date-role-missing"); }
      if (action.time !== undefined) { item.time = action.time; item.flags = item.flags?.filter((f) => f !== "time-not-in-text"); }
      if (item.kind !== "create-event") { item.time = null; item.partOfDay = null; }
      if (inPlace) editAppliedInPlace(state, item);
      else if (wasApplied && item.kind !== "update-task") applyProposal(state, c, p, item);
      c.proposalRevision++;
      return { message: wasApplied ? "Changed" : "Edited · still waiting", entityId: item.id };
    }
    case "save-capture-item": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      const item = requireValue(c.proposals?.find((x) => x.id === action.itemId), "Capture item");
      if (item.state) throw new DomainError(item.state === "applied" ? "Already saved" : "Item was removed");
      applyProposal(state, c, page(state, c.pageId), item);
      settleCaptureStatus(c);
      return { message: "Saved", entityId: item.entityId };
    }
    case "remove-capture-item": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      const item = requireValue(c.proposals?.find((x) => x.id === action.itemId), "Capture item");
      if (item.state === "removed") return { message: "Already removed" };
      if (item.state === "applied") removeApplied(state, item);
      item.state = "removed";
      settleCaptureStatus(c);
      return { message: "Removed", entityId: item.id };
    }
    case "undo-capture": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      const applied = (c.proposals ?? []).filter((x) => x.state === "applied");
      // All or nothing: removeApplied throws "edited since" before anything is kept (the command runs on a copy).
      for (const item of applied) { removeApplied(state, item); item.state = "removed"; }
      for (const item of c.proposals ?? []) if (!item.state) item.state = "removed";
      settleCaptureStatus(c);
      return { message: "Undone · your text is kept", entityId: c.id };
    }
    // ---- feat/model step 1: server-only actions (not in commandSchema) ----
    case "capture-for-model": {
      // His words are saved before any model call (03 §6); the result is recorded later by organized-capture.
      const p = page(state, action.pageId);
      if (typeof action.capturedAt !== "string" || Number.isNaN(Date.parse(action.capturedAt)))
        throw new DomainError("Capture time missing");
      const id = newId();
      state.captures.push({
        id,
        pageId: p.id,
        text: text(action.text),
        capturedAt: new Date(action.capturedAt).toISOString(),
        status: "organizing",
        proposalRevision: 1,
        simulated: false,
        model: action.model,
        proposedTitle: action.text.trim(),
        proposals: [],
        contextLine: "Organizing…",
      });
      return { message: "Saved · organizing", entityId: id };
    }
    case "organized-capture": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      // A capture that moved on (edited, discarded, already organized) never takes a late result (03 §6).
      if (c.status !== "organizing" || c.proposalRevision !== action.revision)
        throw new DomainError("Capture moved on; result not applied");
      const p = page(state, c.pageId);
      c.proposals = structuredClone(action.proposals);
      c.model = action.model;
      c.mode = action.mode;
      c.contextLine = action.contextLine;
      c.error = action.unreadable
        ? `${action.unreadable} part${action.unreadable === 1 ? " wasn't" : "s weren't"} saved as ${action.unreadable === 1 ? "an item" : "items"}`
        : undefined;
      // auto: new items that pass grounding save now; updates and held items wait. confirm: everything waits.
      if (action.mode === "auto")
        for (const proposal of c.proposals)
          if (proposal.kind !== "update-task" && !proposal.flags?.length) applyProposal(state, c, p, proposal);
      const waiting = c.proposals.some((x) => !x.state);
      c.status = waiting ? "needs_confirmation" : "applied";
      const saved = c.proposals.filter((x) => x.state === "applied").length;
      return {
        message: waiting
          ? `${saved ? `${saved} saved · ` : ""}${c.proposals.filter((x) => !x.state).length} waiting for you`
          : `${saved} saved`,
        entityId: c.id,
      };
    }
    case "retry-capture": {
      // Same capture, new revision: the old attempt's late result can no longer apply (03 §6).
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      if (c.status !== "failed" || c.simulated) throw new DomainError("Only a capture that failed can be retried");
      if (c.failure === "budget") throw new DomainError("Today's model budget is used up");
      if (c.failure === "paused") throw new DomainError("Model paused until a cost is confirmed");
      c.status = "organizing";
      c.proposalRevision++;
      c.error = undefined;
      c.failure = undefined;
      c.contextLine = "Organizing…";
      return { message: "Organizing again", entityId: c.id };
    }
    case "model-failed": {
      const c = requireValue(state.captures.find((c) => c.id === action.captureId), "Capture");
      if (c.status !== "organizing" || c.proposalRevision !== action.revision)
        throw new DomainError("Capture moved on; result not applied");
      c.status = "failed";
      c.failure = action.failure;
      c.error = action.error;
      c.contextLine = "Not organized · your text is kept";
      return { message: action.error, entityId: c.id };
    }
    case "save-draft": {
      const p = ensureDay(state, action.date);
      if (!p.draft) throw new DomainError("Prepare a draft before saving choices");
      const ids = [...new Set(action.taskIds)];
      if (ids.some(id => !p.draft!.taskIds.includes(id)))
        throw new DomainError("Draft changed; reload suggestions");
      const materials = [...new Set(action.materialIds)];
      if (materials.some(id => !p.draft!.materialIds.includes(id)))
        throw new DomainError("Related suggestions changed; reload draft");
      p.draft.taskIds = ids;
      p.draft.materialIds = materials;
      return { message: "Suggestions saved for tomorrow; nothing scheduled", simulated: true };
    }
    case "generate-draft": {
      const p = ensureDay(state, action.date);
      // Draft my day on the card: one draft per day (morning-model-states §1); Retry only after a failure.
      if (action.trigger === "card" && hasDayDraft(p)) throw new DomainError("Today already has a draft");
      if (action.outcome && action.outcome !== "success") {
        p.draftError = `Simulated ${action.outcome}; review remains saved`;
        return { message: p.draftError, simulated: true };
      }
      const view = getDayView(state, action.date);
      const candidates = [...view.planned, ...view.handoffTasks, ...view.carry];
      p.draft = {
        simulated: true,
        taskIds: [...new Set(candidates.map((t) => t.id))].slice(0, 3),
        materialIds: state.materials
          .filter(
            (m) =>
              m.resurface &&
              m.reviewState !== "done" &&
              m.reviewState !== "task" &&
              !m.dismissedOn?.includes(action.date),
          )
          .slice(0, 2)
          .map((m) => m.id),
        text: "Simulated draft from saved records. No model was called. Choose what to plan.",
      };
      // The card's stand-in shows one example proposal so its states can be reviewed (card spec §4, §11 step 3).
      if (action.trigger === "card") {
        const prev = previousDayPage(state, action.date);
        const line = prev ? draftLines(prev).find((l) => !isLineLinked(state, l.pageId, l.blockId)) : undefined;
        const block = line && prev!.sections.flatMap((s) => s.blocks).find((b) => b.id === line.blockId);
        p.draft.proposals = line && block ? [{ lineId: line.lineId, pageId: line.pageId, blockId: line.blockId, fingerprint: fingerprintOf(state, prev!, block), date: null }] : [];
        p.draft.hidden = [];
      }
      delete p.draftError;
      return {
        message: "Simulated suggestions saved; nothing scheduled",
        simulated: true,
      };
    }
    case "undo":
    case "keep-planned":
      throw new DomainError("Undo must be handled as one checked command");
    default:
      throw new DomainError("Unsupported operation");
  }
}
export function applyCommand(
  input: Workspace,
  command: Command,
): CommandResult {
  if (
    !command ||
    typeof command.operationId !== "string" ||
    !command.operationId ||
    !command.action ||
    command.operationId.length > 200
  )
    throw new DomainError("Invalid command");
  const fingerprint = JSON.stringify(command.action);
  const existing = input.receipts[command.operationId];
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new DomainError("Operation identity reused with different input");
    return { workspace: structuredClone(input), receipt: existing };
  }
  if (command.expectedRevision !== input.revision)
    throw new DomainError(
      "Saved elsewhere. Reload before applying; your input is kept here.",
    );
  let state = structuredClone(input);
  const { undo: _previousUndo, ...before } = structuredClone(input);
  let result: { message: string; entityId?: string; simulated?: boolean };
  if (
    command.action.type === "undo" ||
    command.action.type === "keep-planned"
  ) {
    const previous = input.undo;
    if (
      !previous ||
      previous.operationId !== command.action.targetOperationId ||
      previous.revision !== input.revision
    )
      throw new DomainError(
        "Cannot undo after later changes; current values kept",
      );
    state = {
      ...structuredClone(previous.before),
      revision: input.revision,
      receipts: structuredClone(input.receipts),
    };
    if (command.action.type === "keep-planned")
      result = execute(state, {
        type: "remove-blocks",
        pageId: command.action.pageId,
        blockIds: [command.action.blockId],
        bulk: true,
        today: "2000-01-01",
      });
    else result = { message: "Previous operation restored" };
  } else result = execute(state, command.action, command.operationId);
  state.revision = input.revision + 1;
  const receipt = { operationId: command.operationId, ...result, fingerprint };
  state.receipts[command.operationId] = receipt;
  if (!["undo", "keep-planned", "ensure-day"].includes(command.action.type))
    state.undo = {
      operationId: command.operationId,
      revision: state.revision,
      before,
    };
  else delete state.undo;
  return { workspace: state, receipt };
}
