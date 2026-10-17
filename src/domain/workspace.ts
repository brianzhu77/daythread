import { pageContentKey, projectDocument, inlineText } from "./editor-document.ts";
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
      sections: (
        ["top3", "other", "events", "good-stuffs", "notes"] as const
      ).map((kind, i) => ({
        id: `${id}:${kind}`,
        kind,
        title: [
          "TODO - Top 3",
          "TODO - Other",
          "Events",
          "Good Stuffs",
          "Notes",
        ][i]!,
        blocks: [],
      })),
    };
    state.pages.push(p);
  }
  return p;
}
function ensureSection(p: Page, kind: Section["kind"]): Section {
  let s = p.sections.find((s) => s.kind === kind);
  if (!s) {
    s = {
      id: newId(),
      kind,
      title:
        kind === "top3"
          ? "TODO - Top 3"
          : kind === "other"
            ? "TODO - Other"
            : kind,
      blocks: [],
    };
    p.sections.push(s);
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
  const p = ensureDay(state, day);
  // Only plan sections own arrangement rows; ordinary Notes references stay put.
  let arrangement: NoteBlock | undefined;
  for (const s of p.sections) {
    if (s.kind !== "top3" && s.kind !== "other") continue;
    const rows = s.blocks.filter(b => b.kind === "task" && b.taskId === t.id);
    arrangement ??= rows[0];
    s.blocks = s.blocks.filter(b => !(b.kind === "task" && b.taskId === t.id));
  }
  if (arrangement) ensureSection(p, target).blocks.push(arrangement);
  else
    ensureSection(p, target).blocks.push({
      id: newId(),
      kind: "task",
      taskId: t.id,
      text: t.title,
    });
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
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol))
    throw new DomainError("Use an http(s) source URL");
  let m = state.materials.find((m) => m.url === url);
  const day =
    p.date ??
    new Date().toLocaleDateString("en-CA", { timeZone: state.timezone });
  if (!m) {
    m = {
      id: newId(),
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
  const b: NoteBlock = {
    id: newId(),
    kind: "material",
    materialId: m.id,
    text: text(note) || title || url,
  };
  s.blocks.push(b);
  m.sources.push({ pageId: p.id, blockId: b.id, note: text(note) });
  return m;
}
export function getDayView(state: Workspace, day: string): DayView {
  date(day);
  const current =
    state.pages.find((p) => p.type === "daily" && p.date === day) ?? null;
  const planned = state.tasks.filter(
    (t) =>
      t.status === "open" &&
      t.plannedOn === day &&
      !state.placements.some(
        (p) => p.taskId === t.id && p.date === day && p.state === "excluded",
      ),
  );
  planned.sort((a, b) => (state.placements.find(p => p.taskId === a.id && p.date === day)?.order ?? 1e9) - (state.placements.find(p => p.taskId === b.id && p.date === day)?.order ?? 1e9));
  const openPool = state.tasks.filter(
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
  const handoffBlocks =
    previous?.sections
      .filter((s) => s.kind === "notes" || s.kind === "good-stuffs")
      .flatMap((s) =>
        s.blocks
          .filter(
            (b) =>
              !b.taskId &&
              !current?.sections.some((sec) =>
                sec.blocks.some(
                  (copy) =>
                    copy.sourcePageId === previous.id &&
                    copy.sourceBlockId === b.id,
                ),
              ),
          )
          .map((block) => ({ pageId: previous.id, block })),
      ) ?? [];
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
    paused: state.tasks.filter((t) => t.status === "open" && t.paused),
    attention: state.tasks.filter(
      (t) =>
        t.status === "open" &&
        ((!!t.deadlineOn && t.deadlineOn <= day) ||
          (!!t.attentionOn && t.attentionOn <= day)),
    ),
    events: state.events.filter((e) => !e.cancelled && e.date === day),
    materialReview,
  };
}
function execute(
  state: Workspace,
  action: Action,
): { message: string; entityId?: string; simulated?: boolean } {
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
      const present = new Set(all.map(n => n.id));
      if (action.history) for (const [blockId, taskId] of Object.entries(p.editorCreations ?? {})) {
        const wasPresent = p.sections.some(s => s.blocks.some(b => b.id === blockId));
        if (!wasPresent || present.has(blockId) && inlineText(all.find(n => n.id === blockId)?.content)) continue;
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
        if (node.props?.taskId !== `editor-task:${node.id}` || previousBlocks.some(b => b.id === node.id && (b.kind !== 'paragraph' || b.text))) throw new DomainError("Unknown Task identity");
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
      const ordered = p.sections.flatMap(s => s.blocks).filter(b => b.kind === 'task' && b.planRole === 'plan');
      ordered.forEach((b, order) => {
        const relation = state.placements.find(x => x.taskId === b.taskId && x.date === p.date && x.state === 'included');
        if (relation) relation.order = order;
      });
      p.editorJSON = action.document;
      p.editorSections = JSON.stringify(p.sections);
      return { message: "Page saved; task arrangements unchanged" };
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
      s.blocks.push(b);
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
      s.blocks.push({ id: newId(), kind: "task", taskId: t.id, text: t.title });
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
      ensureSection(p, "events").blocks.push({
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
      ensureSection(target, sourceSection.kind).blocks.push(copy);
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
      const id = newId();
      state.pages.push({
        id,
        type: "document",
        date: null,
        title: text(action.title, 1000),
        sections: [
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
    case "insert-reference": {
      const p = page(state, action.pageId),
        target = page(state, action.targetPageId);
      const b: NoteBlock = {
        id: newId(),
        kind: "reference",
        targetPageId: target.id,
        text: target.title,
      };
      section(p, action.sectionId).blocks.push(b);
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
          simulated: true,
        };
      if (
        c.status !== "needs_confirmation" ||
        c.proposalRevision !== action.proposalRevision
      )
        throw new DomainError("Capture proposal changed");
      const p = page(state, c.pageId);
      for (const proposal of c.proposals ?? [])
        if (
          proposal.kind === "update-task" &&
          task(state, proposal.taskId!).version !== proposal.expectedVersion
        )
          throw new DomainError("Task changed; mixed group not applied");
      for (const proposal of c.proposals ?? []) {
        if (proposal.kind === "create-task") {
          const t = createTask(state, proposal.title, p, null);
          ensureSection(p, "notes").blocks.push({
            id: newId(),
            kind: "task",
            taskId: t.id,
            text: t.title,
          });
          c.taskId = t.id;
        } else if (proposal.kind === "create-material")
          saveMaterial(
            state,
            p,
            ensureSection(p, "good-stuffs"),
            proposal.url!,
            proposal.title,
          );
        else if (proposal.kind === "update-task") {
          const t = task(state, proposal.taskId!);
          t.status = proposal.status ?? "done";
          t.version++;
        }
      }
      c.status = "applied";
      return {
        message: "Simulated proposal applied; new tasks are unscheduled",
        entityId: c.taskId,
        simulated: true,
      };
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
  } else result = execute(state, command.action);
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
