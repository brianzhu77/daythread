// The domain: commands over the workspace (pure, one at a time, with receipts for replay and one Undo slot) and the
// views every screen reads. Pages and tasks are stored; what a page says about its tasks is read from its document.
import { blockersOf, linkLimits, loopReason, standingLinks } from "./task-links.ts";
import { buttonBlockType, broughtInsertIndex, broughtPrefix, dayRowInsertIndex, emptyLine, emptyTaskRow, flatNodes, inlineText, isEmptyLine, isTaskRow, pageContentKey, pageNodes, rowInsertIndex, rowRole, rowTaskId, sectionInsertIndex, templateDocument, textDate, textRun, type EditorNode } from "./editor-document.ts";
import { dayEvents } from "./chip-events.ts";
import { draftOf, draftPageId, draftReplaceable, draftSettled, eligibleTask, isDraft, normalizeDraftItems, placeItem, remadeItems, type DayDraft } from "./day-draft.ts";
import { builtInDayNodes, dayPagesTarget, daySubpagesTarget, dayTemplateTitle, defaultTemplate, isTemplate, isUntouchedCopy, newPageTemplate, pageFromTemplate, reservedTargets, templateRows, topLevelTarget, rowTemplateDatabaseId, rowTemplateTarget } from "./day-template.ts";
import { automationProblem, dueRules, firedRules, type Automation, type FiredRule, type RuleSource } from "./automations.ts";
import { changesWords, isTodosTarget, readSteps, safeUrl, stepsKey, stepTitle, usesFormulas, valueAtTap, type ButtonStep, type ButtonValue } from "./buttons.ts";
import { format } from "./formula-functions.ts";
import { stepCell } from "./formula.ts";
import { preparedSteps, StepReading, type StepVariables } from "./step-formulas.ts";
import { commentLimit, leavesUndoAlone, propertyNameLimit, type CommentThread, quoteLimit } from "./comments.ts";
import { isPageIcon } from "./page-icon.ts";
import { coverPlace, isCoverLink } from "./page-look.ts";
import { hasContent, isTrashed, moveBefore, moveRefusal, subtreeIds } from "./page-tree.ts";
import { hasDependencyLoop, loopRefusal, shiftDependents, spanOf } from "./dependencies.ts";
import { descendantsOf, hasLoop, parentIdOf } from "./sub-items.ts";
import type { Database, Json, Property, SubItems } from "./database.ts";
import { applyRowMove, movesIntoItself, rowMoveTree } from "./move-row.ts";
import { importRefusal } from "./csv.ts";
import { dueRepeats, periodWord, repeatRowId } from "./repeats.ts";
import { blockedByColumn, newTodo, taskIdOfRow, todoBarColumns, todoChange, todoMoves, todoRowId, todosDatabase, todosTitle, withTodos } from "./todos-source.ts";
import { inView, titleId, todosSourceId, changeDatabase, syncMirror, databaseBlockType, databaseOfRow, databaseRows, editRow, isDatabase, limits as databaseLimits, newDatabase, newRowStored, type RowEdit, keepRowNumbers, numberNewRow, isRow, templateValues } from "./database.ts";
import { defaultLinkTitle, urlKey } from "./url-key.ts";
import type { Action, Command, CommandResult, DayView, Page, Receipt, Task, Workspace } from "./types.ts";
import { acceptSavedBlocks, deleteBlockPlace, expandedWorkspace, isOriginalBlock, isSyncedBlock, settleSynced, storedDocument, unsyncBlock, recordOfLine, lineIdsOnPage } from "./synced.ts";
import { askedQuestions, formOf, isEmptyAnswer, liveQuestions } from "./forms.ts";
import { changeDashboard, isDashboardChange } from "./dashboard.ts";

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
  // A day's draft is reached only through its own commands (B77): no page command can rename, move or open it.
  if (isDraft(p)) throw new DomainError("Not a page");
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
/** The date's live page; one in the trash doesn't hold the date (B16). */
const dayPage = (state: Workspace, day: string): Page | undefined => state.pages.find((p) => p.type === "daily" && p.date === day && !isTrashed(p));
// A template's rows are never a task's place (B70): only live, ordinary pages hold tasks.
/** Tasks with a line on a live page: one in Trash, on a template or in a draft isn't one, a copied line elsewhere is (todo-dependency.md §3). */
export function liveTaskIds(state: Workspace): Set<string> {
  const out = new Set<string>();
  for (const p of livePages(state)) for (const n of flatNodes(pageNodes(p))) { const id = rowTaskId(n); if (id) out.add(id); }
  return out;
}
const livePages = (state: Workspace): Page[] => state.pages.filter((p) => !isTrashed(p) && !isTemplate(p) && !isDraft(p));
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
/** None of a bulk edit's to-dos could take it, so nothing was changed. */
class NoTodoChanged extends DomainError {}
/** Where a button sits, with the list holding it, so blocks can go beside it. */
function buttonPlace(nodes: EditorNode[], id: string): { list: EditorNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.id === id) return { list: nodes, index };
    const inner = node.children?.length ? buttonPlace(node.children, id) : null;
    if (inner) return inner;
  }
  return null;
}
/** A database a step reads from, or why it can't: what's said at the tap, with the pill left as it is (buttons.md §4.4). */
function buttonTarget(state: Workspace, databaseId: string, name: string): Page & { database: Database } {
  const db = state.pages.find((p) => p.id === databaseId);
  if (!db || !isDatabase(db)) throw new DomainError(`${name || "That database"} was deleted`);
  if (isTrashed(db)) throw new DomainError(`${db.title.trim() || name} is in Trash`);
  return db;
}
/** A tap on a button on a page: every step in one operation, so they all apply or none do (buttons.md §4.1). A throw here leaves nothing, as a command works on a copy. */
function runButton(state: Workspace, action: Extract<Action, { type: "run-button" }>, operationId: string): { message: string; entityId?: string } {
  const on = page(state, action.pageId);
  if (isTrashed(on)) throw new DomainError("That page is in Trash");
  if (isTemplate(on)) throw new DomainError("A template doesn't run its buttons");
  const held = buttonPlace(docOf(on), action.blockId);
  const block = held?.list[held.index];
  if (!block || block.type !== buttonBlockType) throw new DomainError("That button's gone");
  const stored = String(block.props?.steps ?? "");
  if (stepsKey(stored) !== action.stepsKey) throw new DomainError("Changed elsewhere");
  const steps = readSteps(stored);
  if (changesWords(steps) && pageContentKey(on) !== action.expectedContent) throw new DomainError("Changed elsewhere");
  const result = runSteps(state, steps, on, action, operationId, action.blockId, newBudget());
  if (result.message === null) throw new DomainError(result.because ?? (result.matchedNothing ? "No rows matched" : "Nothing to do"));
  return { message: result.message, ...(result.made ? { entityId: result.made } : {}) };
}
/** A tap on a Button property: its steps on each row, in one operation with one Undo, sharing one allowance (§6). */
function runRowButton(state: Workspace, action: Extract<Action, { type: "run-row-button" }>, operationId: string): { message: string; entityId?: string } {
  const db = buttonTarget(state, action.databaseId, "That database"), property = db.database.properties.find((p) => p.id === action.propertyId);
  if (!property || property.type !== "button") throw new DomainError("That button's gone");
  const stored = property.button?.steps ?? "";
  if (stepsKey(stored) !== action.stepsKey) throw new DomainError("Changed elsewhere");
  if (new Set(action.rowIds).size !== action.rowIds.length) throw new DomainError("Invalid rows");
  const steps = readSteps(stored), budget = newBudget();
  let message: string | null = null, made: string | undefined, matchedNothing = false, because: string | undefined;
  for (const rowId of action.rowIds) {
    const { row } = rowPage(state, rowId);
    if (row.parentId !== db.id) throw new DomainError("That row moved");
    if (rowTemplateDatabaseId(row)) throw new DomainError("A template doesn't run its buttons");
    const result = runSteps(state, steps, row, action, `${operationId}:${rowId}`, null, budget);
    if (result.message !== null) message = result.message;
    if (result.matchedNothing) matchedNothing = true;
    because ??= result.because;
    made = result.made ?? made;
  }
  if (message === null) throw new DomainError(because ?? (matchedNothing ? "No rows matched" : "Nothing to do"));
  return { message: action.rowIds.length > 1 && steps.some((s) => s.kind === "edit-property") ? `${action.rowIds.length} rows changed` : message, ...(made ? { entityId: made } : {}) };
}
/** `readings`: how many times a formula that reads other rows may read the whole workspace, which each picked row does again (G3-10). */
type ButtonBudget = { rows: number; todos: number; readings: number };
export const formulaReadings = 100;
const newBudget = (): ButtonBudget => ({ rows: databaseLimits.rowsAtOnce, todos: databaseLimits.todosAtOnce, readings: formulaReadings });
/** The steps themselves, on the page or row they're for. */
function runSteps(state: Workspace, steps: ButtonStep[], on: Page, stamp: { at: string; today: string }, operationId: string, blockId: string | null, budget: ButtonBudget): { message: string | null; made?: string; because?: string; matchedNothing: boolean } {
  const at = isoTime(stamp.at), today = date(stamp.today);
  // Every target and the whole list are read first, so a broken one says so before anything else (§4.4).
  for (const step of steps) {
    if (step.kind === "add-row" || step.kind === "edit-rows") {
      if (isTodosTarget(step.databaseId)) continue;
      const db = buttonTarget(state, step.databaseId, step.databaseName);
      for (const set of step.set) if (!db.database.properties.some((p) => p.id === set.id)) throw new DomainError(`${set.name} was deleted`);
    }
    // Opened only after the commit, so a page that can't be opened has to say so before anything's written (§4.7).
    if (step.kind === "open" && step.target.kind === "page") {
      const to = state.pages.find((p) => p.id === (step.target as { pageId: string }).pageId);
      if (!to) throw new DomainError(`${step.target.name || "That page"} was deleted`);
      if (isTrashed(to)) throw new DomainError(`${to.title.trim() || step.target.name} is in Trash`);
    }
    if (step.kind === "open" && step.target.kind === "url" && !safeUrl(step.target.url)) throw new DomainError("That link can't be opened");
  }
  // A formula reads the row it's on; with none, as for a schedule, only a page's name. Each is checked first too, so a broken one drops the tap before anything's written.
  const formulas = usesFormulas(steps), scopeId = formulas ? (taskIdOfRow(on.id) ? todosSourceId : databaseOfRow(state, on)?.id ?? "") : "";
  const ready = formulas ? preparedSteps(steps, state, scopeId) : null;
  ready?.problems.forEach((problem, i) => { if (problem) throw new DomainError(`${stepTitle(steps[i]!)}: ${problem}`); });
  const variables: StepVariables = new Map();
  let reading: StepReading | null = null, readingFor = "";
  const worked = (stored: string, row: Page, databaseId: string, name: string) => {
    readingFor = name;
    // Over it, the whole tap is refused, rather than the first rows changed (Bumblebee).
    reading ??= new StepReading(state, at, ready!.world, () => { if (--budget.readings < 0) throw new DomainError(`Too many rows for ${readingFor}'s formula · ${formulaReadings} at most`); });
    const result = reading.value(stored, row, databaseId, variables);
    if (result.error) throw new DomainError(result.error);
    return result;
  };
  const tap = (value: ButtonValue, property: Property, row: Page = on, databaseId = scopeId): Json => {
    if (value.kind !== "formula") return valueAtTap(value, property, on, today);
    const cell = stepCell(worked(value.text, row, databaseId, property.name).value, property);
    if ("error" in cell) throw new DomainError(cell.error);
    return cell.cell;
  };
  // Counted across the steps, rather than each spending the whole limit (§4.9).
  const spend = (rows: number, todos: boolean) => { if (todos) { budget.todos -= rows; if (budget.todos < 0) throw new DomainError(`${databaseLimits.todosAtOnce} to-dos at most`); } else { budget.rows -= rows; if (budget.rows < 0) throw new DomainError(`${databaseLimits.rowsAtOnce.toLocaleString("en-US")} rows at most`); } };
  let message: string | null = null, made: string | undefined, matchedNothing = false, because: string | undefined;
  const named = <T,>(step: ButtonStep, work: () => T): T => {
    try { return work(); } catch (error) {
      if (error instanceof DomainError && !/ was deleted$| is in Trash$| at most$/.test(error.message)) throw new DomainError(`${stepTitle(step)}: ${error.message}`);
      throw error;
    }
  };
  for (const [index, step] of steps.entries()) {
    // What a step reads is the workspace as this step finds it.
    reading = null;
    const nameOf = (s: Extract<ButtonStep, { kind: "add-row" }>) => (s.titleFormula === undefined ? s.title : format(worked(s.titleFormula, on, scopeId, "the name").value));
    if (step.kind === "variables") named(step, () => {
      for (const v of step.vars) { const { value, type } = worked(v.formula, on, scopeId, v.name); variables.set(v.name, { type, value }); }
    });
    else if (step.kind === "insert") named(step, () => {
      const day = on.date ?? localDay(state, at);
      // Each of these is a new task.
      spend(flatNodes(step.blocks).filter((n) => (n.type === "task" || n.type === "checkListItem") && inlineText(n.content).trim()).length, true);
      const fresh = pageFromTemplate({ document: JSON.stringify(step.blocks) } as Page, on.date, (n) => {
        const words = inlineText(n.content).trim();
        if (!words) return emptyTaskRow(on.date);
        const task = createTask(state, words, on, day);
        return on.date ? planRow(task, on.date) : { id: newId(), type: "task", props: { taskId: task.id, role: "reference", planDate: "" }, content: structuredClone(n.content), children: [] };
      }, (n) => isOriginalBlock(state, n));
      // It's read again each time, as an earlier step of this tap may have changed the page.
      const now = docOf(on), place = blockId ? buttonPlace(now, blockId) : null;
      if (!place) throw new DomainError("That button's gone");
      if (step.place === "above") place.list.splice(place.index, 0, ...fresh);
      else if (step.place === "below") place.list.splice(place.index + 1, 0, ...fresh);
      else if (step.place === "top") now.unshift(...fresh);
      else { const end = now.length && isEmptyLine(now[now.length - 1]!) ? now.length - 1 : now.length; now.splice(end, 0, ...fresh); }
      setDocument(on, now);
      message = "Inserted";
    });
    else if (step.kind === "add-row") named(step, () => {
      spend(1, isTodosTarget(step.databaseId));
      if (isTodosTarget(step.databaseId)) {
        const title = text(nameOf(step), 1000).trim();
        if (!title) throw new DomainError("A to-do needs words");
        const values = Object.fromEntries(step.set.flatMap((set) => { const property = todosDatabase.properties.find((p: Property) => p.id === set.id); return property ? [[set.id, tap(set.value, property)]] : []; }));
        const placed = newTodo(todosDatabase.views[0]!, { today, pageDate: on.date }, undefined, values);
        const dayPage = ensureDay(state, placed.date);
        const task = addTask(state, dayPage, { title, plannedOn: placed.date, ...(placed.attentionOn ? { attentionOn: placed.attentionOn } : {}), ...(placed.deadlineOn ? { deadlineOn: placed.deadlineOn } : {}) });
        made = todoRowId(task.id);
        message = `Added to ${todosTitle}`;
        return;
      }
      const db = buttonTarget(state, step.databaseId, step.databaseName), rowId = `${operationId}:${index}`;
      const values = Object.fromEntries(step.set.map((set) => [set.id, tap(set.value, db.database.properties.find((p) => p.id === set.id)!)]));
      execute(state, { type: "add-row", databaseId: db.id, pageId: rowId, title: nameOf(step), values, at }, operationId);
      made = rowId;
      message = `Added to ${db.title.trim() || step.databaseName}`;
    });
    else if (step.kind === "edit-property") named(step, () => {
      // A to-do's rule: each value through the command the day page and Tasks use, so a tick and its rule are one Undo (automations.md §7).
      const taskId = taskIdOfRow(on.id);
      if (taskId) {
        spend(1, true);
        let changed = false;
        for (const set of step.set) {
          const property = todosDatabase.properties.find((p: Property) => p.id === set.id);
          if (!property) throw new DomainError(`${set.name} was deleted`);
          const change = todoChange(state, taskId, set.id, tap(set.value, property), today);
          if (!change) continue;
          if ("refused" in change) throw new DomainError(change.refused);
          execute(state, change.action, operationId);
          changed = true;
        }
        message = changed ? "1 to-do changed" : message;
        return;
      }
      const owner = databaseOfRow(state, on);
      if (!owner) throw new DomainError("That row moved");
      spend(1, false);
      const properties = step.set.map((set) => owner.database.properties.find((p) => p.id === set.id));
      const values = Object.fromEntries(step.set.map((set, i) => {
        const property = properties[i];
        if (!property) throw new DomainError(`${set.name} was deleted`);
        const value = tap(set.value, property);
        if (!set.mode) return [set.id, value];
        const had = Array.isArray(on.values?.[set.id]) ? (on.values![set.id] as string[]) : [], given = Array.isArray(value) ? (value as string[]) : [];
        return [set.id, set.mode === "add" ? [...new Set([...had, ...given])] : had.filter((x) => !given.includes(x))];
      }));
      rowEdit(state, { pageId: on.id, values, expected: Object.fromEntries(properties.map((p) => [p!.id, (on.values?.[p!.id] ?? null) as Json])) }, at);
      message = "1 row changed";
    });
    else if (step.kind === "edit-rows") named(step, () => {
      const context = { today, pageDate: on.date, zone: state.timezone };
      if (isTodosTarget(step.databaseId)) {
        // A copy's projection: the one kept for `state` itself can be from before an earlier step changed it.
        const rows = databaseRows(withTodos({ ...state }), todosSourceId).filter((r) => inView(todosDatabase, r, { filter: step.filter, ...(step.any ? { filterAny: true } : {}) }, context));
        if (!rows.length) { matchedNothing = true; return; }
        spend(rows.length, true);
        const items = rows.flatMap((r) => { const taskId = taskIdOfRow(r.id); return taskId ? [{ taskId, changes: step.set.map((set) => ({ columnId: set.id, value: tap(set.value, todosDatabase.properties.find((p: Property) => p.id === set.id) ?? ({ type: "text", id: set.id, name: set.name } as Property), r, todosSourceId) })) }] : []; });
        // As the bar's: a to-do that can't take a change, a cancelled one say, is normal here. It reads "3 changed · 1 couldn't", and if none could, later steps carry on, as for no match (Lead 371ebb4b).
        // Only this says nothing changed. Any other refusal can come after some to-dos already have, so it goes up and the whole tap is dropped, as a command works on a copy.
        try { message = execute(state, { type: "edit-todos", items, today }, operationId).message; } catch (error) {
          if (!(error instanceof NoTodoChanged)) throw error;
          matchedNothing = true; because = error.message;
        }
        return;
      }
      const db = buttonTarget(state, step.databaseId, step.databaseName);
      const rows = databaseRows(state, db.id).filter((r) => inView(db.database, r, { filter: step.filter, ...(step.any ? { filterAny: true } : {}) }, context));
      if (!rows.length) { matchedNothing = true; return; }
      spend(rows.length, false);
      const properties = step.set.map((set) => db.database.properties.find((p) => p.id === set.id)!);
      // Worked out before any is written, so a formula reading another row doesn't depend on the order they're in.
      const worth = new Map(rows.map((row) => [row, Object.fromEntries(step.set.map((set, i) => [set.id, tap(set.value, properties[i]!, row, db.id)]))]));
      for (const row of rows) rowEdit(state, { pageId: row.id, values: worth.get(row)!, expected: Object.fromEntries(properties.map((p) => [p.id, (row.values?.[p.id] ?? null) as Json])) }, at);
      message = `${rows.length} row${rows.length === 1 ? "" : "s"} changed`;
    });
  }
  return { message, ...(made ? { made } : {}), ...(because ? { because } : {}), matchedNothing };
}
function commentBody(body: string): string {
  const words = text(body, 20_000).trim();
  if (!words) throw new DomainError("A comment needs words");
  if (words.length > commentLimit) throw new DomainError(`${commentLimit.toLocaleString("en-US")} characters at most`);
  return words;
}
/** A tab that hadn't seen the newest change to this thread can't overwrite it. */
function threadToChange(state: Workspace, threadId: string, version: number): CommentThread {
  const thread = state.threads?.find((t) => t.id === threadId);
  if (!thread) throw new DomainError("That comment's gone");
  if (thread.version !== version) throw new DomainError("Changed elsewhere");
  return thread;
}
/** What a copy or a page made from a template takes on (P1-7). */
const lookOf = (from: Page | undefined): Pick<Page, "icon" | "cover" | "coverPosition"> => ({ ...(from?.icon ? { icon: from.icon } : {}), ...(from?.cover ? { cover: from.cover } : {}), ...(from?.coverPosition !== undefined ? { coverPosition: from.coverPosition } : {}) });
/**
 * The rules a command set off, in order. Each runs on its own copy and is taken whole or not at all, so his edit stands whatever a rule does (automations.md §5.1, §5.5).
 * The allowance is the command's, across them all. Once it's spent, the rest pause, and those that already ran stay (§5.8).
 */
/** Where a database's rules are kept: on its page, or To-dos' on the workspace, as To-dos isn't stored (automations.md §7). */
function rulesIn(state: Workspace, databaseId: string): Automation[] {
  return databaseId === todosSourceId ? state.todoAutomations ?? [] : state.pages.find((p) => p.id === databaseId)!.database!.automations ?? [];
}
function setRulesIn(state: Workspace, databaseId: string, rules: Automation[]): void {
  if (databaseId !== todosSourceId) { state.pages.find((p) => p.id === databaseId)!.database!.automations = rules; return; }
  if (rules.length) state.todoAutomations = rules; else delete state.todoAutomations;
}
/** To-dos as its rules read it: its rows worked out from a copy, as `withTodos` keeps one projection for each workspace object and this one changes in place. */
const todosNow = (state: Workspace): Workspace => withTodos({ ...state });
function ruleDatabase(state: Workspace, databaseId: string): Database {
  if (databaseId !== todosSourceId) return state.pages.find((p) => p.id === databaseId)!.database!;
  return { ...todosNow(state).pages.find((p) => p.id === todosSourceId)!.database!, automations: state.todoAutomations ?? [] };
}
/** A row a rule runs on: a page, or a to-do's row. */
const ruleRow = (state: Workspace, databaseId: string, rowId: string): Page | undefined =>
  (databaseId === todosSourceId ? todosNow(state).pages : state.pages).find((p) => p.id === rowId);
/**
 * To-dos' rows before and after a command, when it has rules. A to-do is added the first time it's saved with words, as only then is it a row,
 * and one coming back from the deleted ones, a cut line pasted back, isn't new (Bumblebee).
 */
function todoSources(before: Workspace, after: Workspace): RuleSource[] {
  const was = todosNow(before), now = todosNow(after), returned = new Set(before.deletedTasks.map((t) => todoRowId(t.id)));
  // A link to a to-do that's deleted goes out of force and stays (todo-dependency.md §3): nothing was edited, so it reads as it was (Bumblebee).
  const kept = (ws: Workspace) => new Set([...ws.tasks, ...ws.deletedTasks].map((t) => t.id));
  const rows = (ws: Workspace, view: Workspace) => { const ids = kept(ws); return view.pages.filter((p) => p.parentId === todosSourceId).map((r) => {
    const taskId = taskIdOfRow(r.id), by = taskId ? blockersOf(ws, taskId).filter((id) => ids.has(id)).map(todoRowId) : [];
    const { [blockedByColumn]: _shown, ...values } = r.values ?? {};
    return { ...r, values: by.length ? { ...values, [blockedByColumn]: by } : values };
  }); };
  const wasRows = rows(before, was), known = new Set(wasRows.map((r) => r.id));
  // A blank box that's never had words is version 1; one whose words were cleared has moved on. Only the first is new (Ratchet).
  const wasBlank = new Map(before.tasks.map((t) => [todoRowId(t.id), t.version]));
  const isNew = (r: Page) => !returned.has(r.id) && (!wasBlank.has(r.id) || wasBlank.get(r.id) === 1);
  return [{ page: { ...now.pages.find((p) => p.id === todosSourceId)!, database: ruleDatabase(after, todosSourceId) } as Page & { database: Database }, before: wasRows, after: rows(after, now).filter((r) => known.has(r.id) || isNew(r)) }];
}
function runAutomations(start: Workspace, fired: FiredRule[], operationId: string): { state: Workspace; automations: NonNullable<Receipt["automations"]> } {
  let state = start;
  const budget = newBudget(), ran: string[] = [], paused: { name: string; reason: string }[] = [], at = isoTime(undefined), today = localDay(state, at);
  let spent = false;
  const pause = (on: Workspace, databaseId: string, ruleId: string, reason: string, limit: boolean) => {
    setRulesIn(on, databaseId, rulesIn(on, databaseId).map((r) => (r.id === ruleId ? { ...r, active: false, paused: { reason, ...(limit ? { limit: true as const } : {}) } } : r)));
  };
  for (const { databaseId, ruleId, rowIds } of fired) {
    const database = ruleDatabase(state, databaseId), rule = rulesIn(state, databaseId).find((r) => r.id === ruleId)!;
    if (spent) { pause(state, databaseId, ruleId, "Not run · command limit reached", true); paused.push({ name: rule.name, reason: "Not run · command limit reached" }); continue; }
    const problem = automationProblem(state, database, rule, databaseId);
    if (problem) { pause(state, databaseId, ruleId, problem, false); paused.push({ name: rule.name, reason: problem }); continue; }
    const copy = structuredClone(state), spentBefore = { ...budget }, steps = readSteps(rule.steps);
    try {
      let changed = false;
      for (const rowId of rowIds) {
        const row = ruleRow(copy, databaseId, rowId);
        if (row && runSteps(copy, steps, row, { at, today }, `${operationId}:${rule.id}:${rowId}`, null, budget).message !== null) changed = true;
      }
      settleSynced(copy);
      if (changed) {
        setRulesIn(copy, databaseId, rulesIn(copy, databaseId).map((r) => (r.id === ruleId ? { ...r, lastRanAt: at } : r)));
        state = copy;
        ran.push(rule.name);
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      Object.assign(budget, spentBefore);
      const limit = / at most$/.test(error.message);
      if (limit) spent = true;
      const reason = limit ? "Not run · command limit reached" : error.message;
      pause(state, databaseId, ruleId, reason, limit);
      paused.push({ name: rule.name, reason });
    }
  }
  return { state, automations: { databaseId: fired[0]!.databaseId, ran, paused } };
}
/**
 * Scheduled rules, in the command that catches up on opening (automations.md §6). The period's marker commits with what it did, so two tabs, a retry or a rollback can't run it twice.
 * Each is taken whole, as on a change, here by writing the copy's result back over this command's state, which `execute` holds by reference.
 */
function runScheduledRules(state: Workspace, action: Extract<Action, { type: "run-repeats" }>, operationId: string): NonNullable<Receipt["automations"]> | null {
  const due = dueRules(state, action.today, action.time);
  if (!due.length) return null;
  const budget = newBudget(), ran: string[] = [], paused: { name: string; reason: string }[] = [], at = isoTime(action.at);
  let spent = false;
  const stop = (databaseId: string, ruleId: string, reason: string, limit: boolean, name: string) => {
    setRulesIn(state, databaseId, rulesIn(state, databaseId).map((r) => (r.id === ruleId ? { ...r, active: false, paused: { reason, ...(limit ? { limit: true as const } : {}) } } : r)));
    paused.push({ name, reason });
  };
  for (const { database, rule, date } of due) {
    if (spent) { stop(database.id, rule.id, "Not run · command limit reached", true, rule.name); continue; }
    const problem = automationProblem(state, ruleDatabase(state, database.id), rule, database.id);
    if (problem) { stop(database.id, rule.id, problem, false, rule.name); continue; }
    const copy = structuredClone(state), before = { ...budget };
    try {
      // A row dates itself to its period through @today (§6), and its id to the rule and period.
      const result = runSteps(copy, readSteps(rule.steps), ruleRow(copy, database.id, database.id)!, { at, today: date }, `every:${rule.id}:${date}`, null, budget);
      setRulesIn(copy, database.id, rulesIn(copy, database.id).map((r) => (r.id === rule.id ? { ...r, ...(result.message !== null ? { lastRanAt: at } : {}), triggers: r.triggers.map((t) => (t.kind === "every" ? { ...t, repeat: { ...t.repeat, last: date, lastRan: at } } : t)) } : r)));
      settleSynced(copy);
      Object.assign(state, copy);
      if (result.message !== null) ran.push(rule.name);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      Object.assign(budget, before);
      const limit = / at most$/.test(error.message);
      if (limit) spent = true;
      stop(database.id, rule.id, limit ? "Not run · command limit reached" : error.message, limit, rule.name);
    }
  }
  return { databaseId: due[0]!.database.id, ran, paused, scheduled: true };
}
/** A task whose title is empty after trimming: an empty checkbox row left on a page. It stays there, but no list shows it. */
export function isBlankTask(t: Task): boolean {
  return !t.title.trim();
}
/** Whether new words can replace a to-do's lines: one holding a chip or a link has more than words, and they'd be lost (R2-9). */
export function canRenameTask(state: Workspace, taskId: string): boolean {
  const plain = (content: unknown) => !Array.isArray(content) || content.every((i: { type?: string; styles?: object }) => i.type === "text" && !Object.keys(i.styles ?? {}).length);
  return state.pages.every((p) => flatNodes(pageNodes(p)).every((n) => rowTaskId(n) !== taskId || plain(n.content)));
}
/** The most recent live day page before `day`. */
export function previousDayPage(state: Workspace, day: string): Page | undefined {
  return state.pages.filter((p) => p.type === "daily" && p.date !== null && p.date < day && !isTrashed(p)).sort((a, b) => (a.date! < b.date! ? 1 : -1))[0];
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
    // Planning never edits a synced block: a row there only becomes a reference here, and the line stays on every page (design §3).
    if (isSyncedBlock(n)) {
      const held = structuredClone(n);
      for (const line of flatNodes(held.children ?? [])) if (ids.has(line.id)) line.props = { ...line.props, role: "reference", planDate: "" };
      out.push(held);
      continue;
    }
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
  else { doc.splice(dayRowInsertIndex(doc, new Set(state.tasks.map((x) => x.id))), 0, planRow(t, day)); changed = true; }
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
function setDraft(state: Workspace, dayPageId: string, draft: DayDraft): void {
  const p = state.pages.find((x) => x.id === draftPageId(dayPageId));
  if (p) p.document = JSON.stringify(draft);
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
    // A page of this date in the trash keeps its id, for Restore (B16).
    let id = `day:${day}`;
    for (let n = 2; state.pages.some((x) => x.id === id && x.type === "daily" && isTrashed(x)); n++) id = `day:${day}:${n}`;
    if (state.pages.some((x) => x.id === id)) throw new DomainError("Page id already in use");
    const template = defaultTemplate(state, dayPagesTarget);
    p = { id, type: "daily", date: day, title: day, ...lookOf(template), document: JSON.stringify(template ? pageFromTemplate(template, day, undefined, (n) => isOriginalBlock(state, n)) : templateDocument(id, day)) };
    state.pages.push(p);
  }
  return p;
}
/** A task and its row on the page: planned on `plannedOn` if that's this day's, in the place to-dos go. */
function addTask(state: Workspace, p: Page, action: { title: string; plannedOn?: string | null; attentionOn?: string | null; deadlineOn?: string | null; id?: string }): Task {
  const on = action.plannedOn ?? p.date ?? new Date().toISOString().slice(0, 10);
  const t = createTask(state, action.title, p, on, action.id);
  if (action.deadlineOn) t.deadlineOn = date(action.deadlineOn);
  if (action.attentionOn) t.attentionOn = date(action.attentionOn);
  const plannedHere = Boolean(action.plannedOn && p.type === "daily" && p.date === action.plannedOn);
  const doc = docOf(p);
  const row = plannedHere ? planRow(t, p.date!) : { ...planRow(t, ""), props: { taskId: t.id, role: "reference", planDate: "" } };
  const insertAt = p.type === "daily" ? dayRowInsertIndex : rowInsertIndex;
  doc.splice(insertAt(doc, new Set(state.tasks.map((x) => x.id))), 0, row);
  setDocument(p, doc);
  if (action.plannedOn && !plannedHere) planOn(state, t, date(action.plannedOn));
  return t;
}
/**
 * A day page coming back to a date that has a new page (B16): it takes the date back, and what the new page holds joins
 * it, below its own lines, so nothing is lost. A new page with nothing written just goes.
 */
function joinNewDayPage(state: Workspace, restored: Page): boolean {
  const newer = dayPage(state, restored.date!);
  if (!newer) return false;
  const children = state.pages.filter((x) => x.parentId === newer.id);
  const pages = children.filter((x) => !isDraft(x));
  // A to-do picked up again on the new page is the same to-do: one row of it, unless lines are nested under the new one.
  const doc = docOf(restored);
  const held = new Map(flatNodes(doc).flatMap((n) => { const id = rowTaskId(n); return id ? [[id, n] as const] : []; }));
  const extra = flatNodes(docOf(newer)).filter((n) => held.has(rowTaskId(n) ?? "") && !n.children?.length);
  for (const n of extra) if (rowRole(n) === "plan") setRole(doc, rowTaskId(n)!, "plan", restored.date!);
  const rest = removeNodes(docOf(newer), new Set(extra.map((n) => n.id)));
  // A heading he changed is writing too; the template's own aren't.
  const headings = (p: Pick<Page, "document">) => flatNodes(pageNodes(p)).filter((n) => n.type === "heading").map((n) => inlineText(n.content).trim());
  const own = new Set(headings(restored));
  const kept = { ...newer, document: JSON.stringify(rest) };
  const written = hasContent(kept) || headings(kept).some((h) => h && !own.has(h));
  const joined = written || pages.length > 0;
  setDocument(restored, written ? [...doc, ...rest] : doc);
  for (const x of pages) x.parentId = restored.id;
  if (newer.handoffDone) restored.handoffDone = true;
  if (newer.reviewSaved) restored.reviewSaved = true;
  const gone = new Set([newer.id, draftPageId(newer.id)]);
  for (const thread of state.threads ?? []) if (thread.pageId === newer.id) thread.pageId = restored.id;
  state.pages = state.pages.filter((x) => !gone.has(x.id));
  return joined;
}
function restorePages(state: Workspace, ids: Set<string>): { pages: Page[]; toTopLevel: Page[]; joined: boolean } {
  let pages = state.pages.filter((p) => ids.has(p.id));
  const toTopLevel: Page[] = [];
  let joined = false;
  for (const p of pages) if (p.type === "daily" && p.date && joinNewDayPage(state, p)) joined = true;
  pages = state.pages.filter((p) => ids.has(p.id));
  for (const p of pages) { delete p.trashedAt; delete p.trashId; }
  for (const p of pages) {
    if (!p.parentId || ids.has(p.parentId)) continue;
    const parent = state.pages.find((x) => x.id === p.parentId);
    if (!parent || isTrashed(parent)) {
      delete p.parentId; toTopLevel.push(p);
      // Its home block stays in the trashed page: at the top level it is a full page.
      if (p.database) p.database.homeBlockId = null;
    }
  }
  return { pages, toTopLevel, joined };
}
/** The pages to trash with `p`, as one batch: it and its live descendants (a database's rows with it). */
/** Duplicating copies the tree, each copy linked to the new parent, never to the old rows (sub-items design §2). Ids follow from the copy's, so the browser's preview and the server agree. */
function copySubItems(state: Workspace, db: Page & { database: NonNullable<Page["database"]> }, tree: SubItems, from: Page, to: Page, day: string, at: string): void {
  const children = databaseRows(state, db.id).filter((r) => parentIdOf(r, tree) === from.id);
  children.forEach((child, i) => {
    const { [tree.sub]: _theirs, ...values } = structuredClone(child.values ?? {});
    const copy: Page = { ...child, id: `${to.id.slice(0, 80)}.${i}`, parentId: db.id, values: { ...values, [tree.parent]: [to.id] }, createdAt: at, editedAt: at };
    copy.document = JSON.stringify(copiedBody(state, child, copy, day));
    numberNewRow(db.database, copy);
    for (const p of db.database.properties) { const raw = copy.values?.[p.id]; if (p.type === "relation" && Array.isArray(raw)) syncMirror(state, p, copy.id, [], raw as string[], at); }
    state.pages.push(copy);
    copySubItems(state, db, tree, child, copy, day, at);
  });
}
/** A row's sub-items go with it, however deep (sub-items design §2). */
function subItemsGoing(state: Workspace, p: Page): Page[] {
  const db = databaseOfRow(state, p);
  return db?.database.subItems ? descendantsOf(databaseRows(state, db.id), db.database.subItems, p.id) : [];
}
function trashSubtree(state: Workspace, p: Page, at: string, operationId: string): Page[] {
  const ids = subtreeIds(state, p.id);
  for (const sub of subItemsGoing(state, p)) for (const id of subtreeIds(state, sub.id)) ids.add(id);
  const members = state.pages.filter((x) => ids.has(x.id) && !isTrashed(x));
  for (const x of members) { x.trashedAt = at; x.trashId = operationId; }
  return members;
}
/**
 * Several at once (a bar's Delete): what `trashSubtree` reaches for each of them, walking the workspace once, or All on a big table takes seconds.
 * Returns how many sub-items went that weren't picked. Two tests hold it to the one at a time: `tests/bar-limit.test.ts`.
 */
function trashTogether(state: Workspace, pages: Page[], at: string, operationId: string): number {
  const children = new Map<string, Page[]>(), subs = new Map<string, Page[]>(), byId = new Map(state.pages.map((x) => [x.id, x]));
  const add = (map: Map<string, Page[]>, key: string, x: Page) => { const list = map.get(key); if (list) list.push(x); else map.set(key, [x]); };
  for (const x of state.pages) {
    if (!x.parentId) continue;
    const parent = byId.get(x.parentId);
    // As `subtreeIds`: a template's parentId is what it's the default for, and it never goes with that page.
    if (!isTemplate(x) && !isDraft(x)) add(children, x.parentId, x);
    const links = isDatabase(parent) && x.type === "document" && !isTrashed(x) ? parent.database.subItems : undefined;
    const up = links ? parentIdOf(x, links) : null;
    if (up) add(subs, up, x);
  }
  const picked = new Set(pages.map((p) => p.id)), going = new Set<string>();
  const under = (id: string, map: Map<string, Page[]>, into: Set<string>) => {
    for (const stack = [id]; stack.length; ) for (const x of map.get(stack.pop()!) ?? []) if (!into.has(x.id)) { into.add(x.id); stack.push(x.id); }
  };
  for (const id of picked) under(id, subs, going);
  const ids = new Set([...picked, ...going]);
  for (const id of [...ids]) under(id, children, ids);
  for (const x of state.pages) if (ids.has(x.id) && !isTrashed(x)) { x.trashedAt = at; x.trashId = operationId; }
  return [...going].filter((id) => !picked.has(id)).length;
}
function isoTime(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DomainError("Invalid time");
  return value;
}
/** A live database the command may change. */
function databasePage(state: Workspace, id: string): Page & { database: NonNullable<Page["database"]> } {
  const p = page(state, id);
  if (!isDatabase(p)) throw new DomainError("Not a database");
  if (isTrashed(p)) throw new DomainError("Page is in trash");
  return p;
}
/** A live row of a live database. */
function rowPage(state: Workspace, id: string, orTemplate = false): { row: Page; db: Page & { database: NonNullable<Page["database"]> } } {
  const row = page(state, id), templateOf = orTemplate ? rowTemplateDatabaseId(row) : null, owner = templateOf ? state.pages.find((p) => p.id === templateOf) : undefined;
  const db = templateOf ? (isDatabase(owner) ? owner : null) : databaseOfRow(state, row);
  if (!db) throw new DomainError("Not a row");
  if (isTrashed(row) || isTrashed(db)) throw new DomainError("Page is in trash");
  return { row, db };
}
/** Pages are made in a page, never in a database (its children are its rows) or a template. */
function pageParent(state: Workspace, id: string): Page {
  const parent = ordinaryPage(state, id);
  if (isDatabase(parent)) throw new DomainError("Pages can't go into a database");
  if (isTrashed(parent)) throw new DomainError("Page is in trash");
  return parent;
}
function rowEdit(state: Workspace, edit: RowEdit, at: string): string[] {
  if (!edit || typeof edit.pageId !== "string") throw new DomainError("Invalid row");
  const { row, db } = rowPage(state, edit.pageId, true);
  if (edit.databaseId && edit.databaseId !== db.id) throw new DomainError(`This row moved to ${db.title.trim() || "another database"}`);
  const links = (id: string) => { const raw = row.values?.[id]; return Array.isArray(raw) ? (raw as string[]) : []; };
  const relations = db.database.properties.filter((p) => p.type === "relation" && edit.values && p.id in edit.values);
  const before = relations.map((p) => links(p.id));
  const deps = db.database.dependencies, dateChanges = Boolean(deps && edit.values && (deps.date in edit.values || (deps.end && deps.end in edit.values))) && !rowTemplateDatabaseId(row);
  const spanBefore = deps && dateChanges ? spanOf(db.database, deps, row) : null;
  try { editRow(db.database, row, edit, at); } catch (error) { throw new DomainError((error as Error).message); }
  // A template isn't a row, so nothing links back to it; the rows made from it do that.
  if (!rowTemplateDatabaseId(row)) relations.forEach((p, i) => syncMirror(state, p, row.id, before[i]!, links(p.id), at));
  const tree = db.database.subItems;
  if (tree && edit.values && (tree.parent in edit.values || tree.sub in edit.values) && !rowTemplateDatabaseId(row) && hasLoop(databaseRows(state, db.id), tree, row.id)) throw new DomainError("A row can't be its own ancestor");
  if (deps && edit.values && (deps.blockedBy in edit.values || deps.blocking in edit.values) && !rowTemplateDatabaseId(row) && hasDependencyLoop(databaseRows(state, db.id), deps, row.id)) throw new DomainError(loopRefusal);
  return deps && dateChanges ? shiftDependents(db.database, deps, databaseRows(state, db.id), row.id, spanBefore, spanOf(db.database, deps, row), at) : [];
}
function addRows(state: Workspace, db: ReturnType<typeof databasePage>, rows: Array<{ pageId: string; title: string; values?: Record<string, import("./database.ts").Json> }>, at: string): void {
  if (databaseRows(state, db.id).length + rows.length > 10_000) throw new DomainError("Too many rows");
  const taken = new Set(state.pages.map((p) => p.id));
  for (const { pageId, title, values: input } of rows) {
    if (taken.has(pageId) || reservedTargets.has(pageId)) throw new DomainError("Page id already in use");
    taken.add(pageId);
    let values: Page["values"];
    try { values = newRowStored(db.database, input); } catch (error) { throw new DomainError((error as Error).message); }
    const row: Page = { id: pageId, type: "document", date: null, title: text(title, 1000).trim(), parentId: db.id, document: JSON.stringify([emptyLine("paragraph")]), ...(values ? { values } : {}), createdAt: at, editedAt: at };
    numberNewRow(db.database, row);
    for (const p of db.database.properties) { const raw = row.values?.[p.id]; if (p.type === "relation" && Array.isArray(raw)) syncMirror(state, p, row.id, [], raw as string[], at); }
    state.pages.push(row);
  }
}
/** The local day of an ISO time in the workspace's zone. */
const localDay = (state: Workspace, at: string): string => new Date(at).toLocaleDateString("en-CA", { timeZone: state.timezone });
/** A4: what Restore on a page brings back: the page plus its descendants trashed in the same delete. */
function restoreSetOf(state: Workspace, p: Page): Set<string> {
  const ids = new Set([p.id]);
  // Sub-items that went with it, which are its database's children and not its own (sub-items design §2).
  const db = databaseOfRow(state, p);
  if (db?.database.subItems) {
    const together = state.pages.filter((x) => x.parentId === db.id && x.trashId === p.trashId);
    for (const sub of descendantsOf(together, db.database.subItems, p.id)) ids.add(sub.id);
  }
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
const lineKey = (n: EditorNode, pageDate: string | null) => inlineText(n.content, pageDate).replace(/\s+/g, " ").trim();

/**
 * The databases whose place is in `p`, after a save of it (model §3): a home block gone from the page trashes its
 * database and rows as one batch (one Undo), unless the save turns it into a full page (`detachDatabaseIds`); a block
 * the save adopts becomes the home of a database that has none. Every other `database` block is a view and needs nothing.
 */
function placeDatabases(state: Workspace, p: Page, before: EditorNode[], after: EditorNode[], action: Extract<Action, { type: "save-editor" }>, operationId: string): { id: string; title: string; rows: number } | null {
  const had = new Set(before.map((n) => n.id));
  const blocks = new Map(after.filter((n) => n.type === databaseBlockType).map((n) => [n.id, n]));
  const detach = new Set(action.detachDatabaseIds ?? []);
  let trashed: { id: string; title: string; rows: number } | null = null;
  for (const db of state.pages) {
    if (!isDatabase(db) || db.parentId !== p.id || isTrashed(db) || db.database.homeBlockId === null) continue;
    const home = db.database.homeBlockId;
    if (blocks.get(home)?.props?.pageId === db.id) continue;
    if (detach.has(db.id)) { db.database.homeBlockId = null; continue; }
    if (!had.has(home)) continue;
    const rows = databaseRows(state, db.id).length;
    trashSubtree(state, db, isoTime(action.at), operationId);
    trashed ??= { id: db.id, title: db.title, rows };
  }
  // The home block back in its page (the editor's ⌘Z after deleting it) brings its database back from the trash with
  // the rows trashed with it, so Undo in the page is Undo of the delete.
  for (const db of state.pages) {
    if (!isDatabase(db) || db.parentId !== p.id || !isTrashed(db) || db.database.homeBlockId === null) continue;
    const home = db.database.homeBlockId;
    if (had.has(home) || blocks.get(home)?.props?.pageId !== db.id) continue;
    const parent = state.pages.find((x) => x.id === db.parentId);
    if (parent && isTrashed(parent)) continue;
    restorePages(state, restoreSetOf(state, db));
  }
  for (const { blockId, pageId } of action.adoptDatabaseBlocks ?? []) {
    const block = blocks.get(blockId), db = state.pages.find((x) => x.id === pageId);
    // One that can't be adopted stays what it is: a view of that database.
    if (!block || block.props?.pageId !== pageId || !isDatabase(db) || isTrashed(db) || db.database.homeBlockId !== null) continue;
    // Never into itself or one of its rows.
    if (subtreeIds(state, db.id).has(p.id)) continue;
    db.parentId = p.id;
    db.database.homeBlockId = blockId;
  }
  return trashed;
}
/** A duplicated row's body: fresh block ids, and its to-dos as new tasks of the copy (same state), so ticking one never ticks the other. */
function copiedBody(state: Workspace, from: Page, to: Page, on: string): EditorNode[] {
  const visit = (n: EditorNode): EditorNode => {
    // A synced block in a duplicated row, as on a template (design §7): its own if it's the original here, else still connected.
    if (isSyncedBlock(n) && !isOriginalBlock(state, n)) return { id: newId(), type: n.type, props: { syncId: String(n.props?.syncId), roles: "" }, children: [] };
    if (isSyncedBlock(n)) return { id: newId(), type: n.type, props: { syncId: newId(), roles: "" }, children: (n.children ?? []).map(visit) };
    const copy: EditorNode = { ...structuredClone(n), id: newId(), children: (n.children ?? []).map(visit) };
    const taskId = rowTaskId(n), t = taskId ? state.tasks.find((x) => x.id === taskId) : undefined;
    if (t) {
      // The copy keeps each to-do's state, as Notion's Duplicate does: a done to-do is done in the copy too.
      const fresh = createTask(state, t.title, to, on);
      fresh.status = t.status; fresh.doneOn = t.doneOn ?? null;
      copy.props = { ...copy.props, taskId: fresh.id, role: "reference", planDate: "" };
    }
    else if (taskId) copy.props = { ...copy.props, taskId: `editor-task:${copy.id}` };
    if (Array.isArray(copy.content)) copy.content = (copy.content as { type?: string; props?: Record<string, unknown> }[]).map((c) => c?.type === "pageRef" ? { ...c, props: { ...c.props, refId: newId() } } : c);
    return copy;
  };
  return pageNodes(from).map(visit);
}

/** The same answer every time, so a client that misses a rename and sends the old id again gets the same one (B29). */
function derivedLineId(id: string, pageId: string): string {
  const hex = cyrb128(`${id}|${pageId}`).padEnd(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/**
 * One page holds a line's id (B29), so a link to it can follow it there. A line new to this page, with an id another page
 * already has (Trash too), gets a new one: the first to save keeps it, and a link stays with that line.
 */
function claimLineIds(state: Workspace, p: Page, nodes: readonly EditorNode[]): Record<string, string> | undefined {
  const here = new Set(flatNodes(pageNodes(p)).map((n) => n.id));
  const fresh = nodes.filter((n) => !here.has(n.id));
  if (!fresh.length) return undefined;
  const elsewhere = new Set<string>();
  for (const other of state.pages) if (other.id !== p.id) for (const n of flatNodes(pageNodes(other))) elsewhere.add(n.id);
  const inUse = new Set(nodes.map((n) => n.id));
  let renamed: Record<string, string> | undefined;
  for (const n of fresh) {
    if (!elsewhere.has(n.id)) continue;
    let id = derivedLineId(n.id, p.id);
    while (elsewhere.has(id) || inUse.has(id)) id = derivedLineId(id, p.id);
    (renamed ??= {})[n.id] = id;
    inUse.add(id);
    n.id = id;
  }
  return renamed;
}

// ---------------------------------------------------------------- commands

function execute(state: Workspace, action: Action, operationId: string): { message: string; entityId?: string; skippedRepeats?: Array<{ title: string; earlier: string; full?: true }>; renamed?: Record<string, string>; conflicted?: string[] } {
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
      const renamed = claimLineIds(state, p, all);
      const conflicted = acceptSavedBlocks(state, p, nodes, (message) => { throw new DomainError(message); }, isoTime(action.at));
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
      // A page's body edited moves its Edited time, a day page's as any other's (Brian bb1d8ff7): a row's Edited
      // property and what a day draft reads. A save with nothing new, as on opening, doesn't (R3-9); nor does an edit
      // inside a synced block, which changes its record, not this page's own document.
      if (storedDocument(JSON.stringify(nodes)) !== storedDocument(p.document)) p.editedAt = isoTime(action.at);
      setDocument(p, nodes);
      for (const [id, rows] of gone) {
        const t = state.tasks.find((x) => x.id === id);
        if (!t) continue;
        settleAfterRowsLeft(state, p, t, { single: rows.some((r) => single.has(r.id)), wasPlan: rows.some((r) => rowRole(r) === "plan"), today: action.today, plannedBefore: plannedBefore.get(id) ?? null });
      }
      const trashed = placeDatabases(state, p, before, all, action, operationId);
      // The wording he sees (checklist R1-15): "Reading list and its 3 rows moved to Trash".
      if (trashed) return { message: `${trashed.title.trim() || "Untitled"}${trashed.rows ? ` and its ${trashed.rows} row${trashed.rows === 1 ? "" : "s"}` : ""} moved to Trash`, entityId: trashed.id };
      return { message: "Page saved", ...(renamed ? { renamed } : {}), ...(conflicted.length ? { conflicted } : {}) };
    }
    case "ensure-day": {
      const p = ensureDay(state, action.date);
      return { message: "Day opened", entityId: p.id };
    }
    case "add-task": {
      const t = addTask(state, ordinaryPage(state, action.pageId), action);
      return { message: "Task added", entityId: t.id };
    }
    case "link-tasks": {
      const t = state.tasks.find((x) => x.id === action.taskId);
      if (!t) throw new DomainError("That to-do was deleted");
      const add = [...new Set(action.add)], remove = new Set(action.remove);
      if (add.some((id) => remove.has(id))) throw new DomainError("Invalid links");
      // Taking one off needs neither end to be there: a link to a deleted to-do is kept, and this is how it goes.
      let links = (state.links ?? []).filter((l) => !(l.blockedId === t.id && remove.has(l.blockerId)));
      const removed = (state.links?.length ?? 0) - links.length;
      const live = add.length ? liveTaskIds(state) : new Set<string>();
      if (add.length && !live.has(t.id)) throw new DomainError("That to-do is in Trash");
      let added = 0, named: string | undefined;
      for (const id of add) {
        if (links.some((l) => l.blockedId === t.id && l.blockerId === id)) continue;
        const blocker = state.tasks.find((x) => x.id === id);
        if (!blocker) throw new DomainError("That to-do was deleted");
        if (!live.has(id)) throw new DomainError(`${blocker.title.trim() || "That to-do"} is in Trash`);
        // Under the workspace's lock, against every link, in force or not (Ratchet).
        const loop = loopReason({ links, tasks: state.tasks, deletedTasks: state.deletedTasks }, t.id, id);
        if (loop) throw new DomainError(loop === "Waits on this one" ? `${blocker.title.trim() || "That to-do"} already waits on this one` : loop);
        links.push({ blockedId: t.id, blockerId: id, createdAt: isoTime(action.at) });
        added++;
        named = blocker.title.trim() || undefined;
      }
      // Over a limit, the whole change is refused rather than some of it made.
      const standing = standingLinks({ links, tasks: state.tasks });
      if (standing.filter((l) => l.blockedId === t.id).length > linkLimits.perTask) throw new DomainError(`${linkLimits.perTask} blockers at most`);
      if (standing.length > linkLimits.total) throw new DomainError(`${linkLimits.total.toLocaleString("en-US")} links at most`);
      if (!added && !removed) throw new DomainError("Nothing to change");
      if (links.length) state.links = links; else delete state.links;
      return { message: added === 1 && !removed && named ? `Blocked by ${named}` : !added ? (removed === 1 ? "Unblocked" : `${removed} blockers taken off`) : "Blockers changed", entityId: t.id };
    }
    case "task-status": {
      const t = task(state, action.taskId);
      t.status = action.status;
      t.doneOn = action.status === "done" ? (action.today ? date(action.today) : null) : null;
      t.version++;
      return { message: action.status === "done" ? "Done" : action.status === "cancelled" ? "Cancelled" : "Reopened", entityId: t.id };
    }
    case "rename-task": {
      const t = task(state, action.taskId), title = text(action.title, 1000).trim();
      if (!title) throw new DomainError("A to-do needs words");
      if (!canRenameTask(state, t.id)) throw new DomainError("This line has more than words");
      t.title = title;
      t.version++;
      // Every page, Trash too: a page restored later shouldn't bring back the old words.
      for (const p of state.pages) {
        const doc = docOf(p);
        let changed = false;
        for (const n of flatNodes(doc)) if (rowTaskId(n) === t.id && inlineText(n.content, textDate(p)) !== title) { n.content = [textRun(title)]; changed = true; }
        if (changed) setDocument(p, doc);
      }
      return { message: "Renamed", entityId: t.id };
    }
    case "set-task-dates": {
      const t = task(state, action.taskId);
      if (action.attentionOn !== undefined) t.attentionOn = action.attentionOn === null ? null : date(action.attentionOn);
      if (action.deadlineOn !== undefined) t.deadlineOn = action.deadlineOn === null ? null : date(action.deadlineOn);
      t.version++;
      return { message: "Date set", entityId: t.id };
    }
    case "unsync-block":
    case "delete-synced-place": {
      const here = pageNodes(page(state, action.pageId));
      const block = flatNodes(here).find((n) => n.id === action.blockId);
      const syncId = block?.props?.syncId;
      if (!block || typeof syncId !== "string") throw new DomainError("Block not found");
      if (action.type === "unsync-block") {
        if (action.all && state.synced?.find((r) => r.id === syncId)?.original !== block.id) throw new DomainError("Only the original can do that");
        const places = unsyncBlock(state, syncId, block.id, Boolean(action.all));
        const others = places - 1;
        return { message: action.all ? `Unsynced on ${places} ${places === 1 ? "page" : "pages"}` : others ? "Unsynced here" : "Unsynced", entityId: action.pageId };
      }
      const { places, wasOriginal } = deleteBlockPlace(state, syncId, block.id);
      const others = places - 1;
      return { message: !others ? "Deleted" : wasOriginal ? `Removed · the other ${others} ${others === 1 ? "page keeps its" : "pages keep their"} lines, no longer synced` : `Removed from this page · still on ${others} ${others === 1 ? "page" : "pages"}`, entityId: action.pageId };
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
      // `brought:` ids let the next brought line join this one's group without reading his words (B75).
      const copy: EditorNode = { id: `${broughtPrefix}${newId()}`, type: node.type, props: {}, content: freshRefs(node.content), children: [] };
      const doc = docOf(p);
      const fromHeading = headingAbove(sourceDoc, node.id), fromTitle = fromHeading ? inlineText(fromHeading.content).trim().toLowerCase() : "";
      const sameName = (n: EditorNode) => n.type === "heading" && inlineText(n.content).trim().toLowerCase() === fromTitle;
      const target = (fromTitle ? doc.find(sameName) : undefined) ?? doc.find((n) => n.type === "heading" && inlineText(n.content).trim().toLowerCase() === "notes");
      // A heading he removed from his day is never brought back (B70). With neither heading (B75, Bumblebee 13a9a7f6,
      // Lead 9ded39e6): right after the carried to-dos, after the lines brought before it, never under a label of his.
      if (target) doc.splice(sectionInsertIndex(doc, target.id), 0, copy);
      else doc.splice(broughtInsertIndex(doc, new Set(state.tasks.map((x) => x.id))), 0, copy);
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
      if (reservedTargets.has(id)) throw new DomainError("Page id already in use");
      const existing = state.pages.find((p) => p.id === id);
      if (existing) {
        if (existing.type !== "document" || (existing.parentId ?? null) !== (action.parentId ?? null)) throw new DomainError("Page id already in use");
        return { message: "Page saved", entityId: id };
      }
      const parent = action.parentId ? pageParent(state, action.parentId) : undefined;
      const body = text(action.body);
      const line = emptyLine("paragraph");
      if (body) line.content = [textRun(body)];
      // B70 (Lead 80555761): a new page with an empty body starts from the nearest default, however it was made; its
      // title isn't copied. Only a page made with words keeps them and gets no template.
      const template = !body ? newPageTemplate(state, parent) : undefined;
      const nodes = template ? pageFromTemplate(template, null, undefined, (n) => isOriginalBlock(state, n)) : [line];
      state.pages.push({ id, type: "document", date: null, title: text(action.title, 1000), ...(action.parentId ? { parentId: action.parentId } : {}), ...lookOf(template), document: JSON.stringify(nodes) });
      return { message: "Page saved", entityId: id };
    }
    case "make-link-pages": {
      const parent = ordinaryPage(state, action.parentPageId);
      if (isDatabase(parent)) throw new DomainError("Pages can't go into a database");
      let first: string | undefined;
      for (const item of action.items) {
        if (state.pages.some((p) => p.id === item.pageId)) { first ??= item.pageId; continue; }
        const url = text(item.url.trim(), 10_000);
        const owner = urlOwner(state, url);
        if (owner.key === null) throw new DomainError("Use an http(s) link");
        if (!owner.page) {
          const linkText = item.title?.trim();
          const title = linkText && linkText !== url ? text(linkText, 1000) : defaultLinkTitle(url);
          // A link page has no words of its own either, so it starts from the default for pages made there (Lead 80555761).
          const template = newPageTemplate(state, parent);
          state.pages.push({ ...(action.at ? { createdAt: isoTime(action.at) } : {}), id: item.pageId, type: "document", date: null, title, url, parentId: parent.id, document: JSON.stringify(template ? pageFromTemplate(template, null) : [emptyLine("paragraph")]) });
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
      // Untouched: still the blank line it was made with, or still the template's copy (B70); nothing made inside it.
      // The template copy is checked first: a template of one empty to-do or bullet is also "one empty line", and its
      // row must stay below the quote (Ratchet a8ecb37a).
      const template = newPageTemplate(state, p.parentId ? state.pages.find((x) => x.id === p.parentId) : undefined);
      const fromTemplate = Boolean(template) && isUntouchedCopy(template!, nodes);
      const blank = !fromTemplate && nodes.length === 1 && nodes[0]!.type !== databaseBlockType && isEmptyLine(nodes[0]!);
      // A template aimed at this page isn't a page made inside it (Ratchet e9857f63).
      const untouched = (blank || fromTemplate) && !state.pages.some((c) => c.parentId === p.id && !isTrashed(c) && !isTemplate(c) && !isDraft(c));
      if (!untouched) return unchanged;
      const title = action.title?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
      const description = action.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
      const quote = description && description.toLocaleLowerCase() !== (title ?? p.title).toLocaleLowerCase() ? description : null;
      if (!title && !quote) return unchanged;
      if (title) p.title = title;
      const quoteNode: EditorNode = { id: newId(), type: "quote", props: {}, content: [textRun(quote ?? "")], children: [] };
      if (quote) setDocument(p, fromTemplate ? [quoteNode, ...nodes] : [quoteNode, emptyLine("paragraph", nodes[0]!.id)]);
      return { message: title ? `Named '${p.title}'` : "Link page filled in", entityId: p.id };
    }
    case "rename-page": {
      const p = page(state, action.pageId);
      if (p.type === "daily") throw new DomainError("Day pages are named by their date");
      p.title = text(action.title, 1000).trim();
      if (isRow(state, p)) p.editedAt = isoTime(undefined);
      return { message: "Page renamed", entityId: p.id };
    }
    case "add-comment": {
      const body = commentBody(action.body), at = isoTime(action.at);
      const existing = state.threads?.find((t) => t.id === action.threadId);
      if (existing) {
        if (existing.pageId !== action.pageId) throw new DomainError("Not a comment on this page");
        if (existing.comments.some((c) => c.id === action.commentId)) throw new DomainError("Comment id already in use");
        existing.comments.push({ id: action.commentId, body, at });
        existing.version++;
        return { message: "Reply added", entityId: existing.id };
      }
      const on = page(state, action.pageId);
      if (isTrashed(on)) throw new DomainError("That page is in Trash");
      if (action.anchor && action.property) throw new DomainError("A comment is on a line or a property, not both");
      // On a property of this row, as the row's database has it now.
      if (action.property && !rowPage(state, on.id).db.database.properties.some((p) => p.id === action.property!.propertyId)) throw new DomainError("That property's gone");
      const property = action.property && { propertyId: action.property.propertyId, name: action.property.name.slice(0, propertyNameLimit), quote: action.property.quote.slice(0, quoteLimit) };
      (state.threads ??= []).push({ id: action.threadId, pageId: on.id, ...(property ? { property } : {}), ...(action.anchor ? { anchor: { blockId: action.anchor.blockId, quote: action.anchor.quote.slice(0, quoteLimit), ...(action.anchor.taskId ? { taskId: action.anchor.taskId } : {}), ...(action.anchor.at !== undefined ? { at: action.anchor.at } : {}) } } : {}), version: 1, createdAt: at, comments: [{ id: action.commentId, body, at }] });
      return { message: "Comment added", entityId: action.threadId };
    }
    case "edit-comment": {
      const thread = threadToChange(state, action.threadId, action.version), comment = thread.comments.find((c) => c.id === action.commentId);
      if (!comment) throw new DomainError("That comment's gone");
      comment.body = commentBody(action.body);
      comment.editedAt = isoTime(action.at);
      thread.version++;
      return { message: "Comment changed", entityId: thread.id };
    }
    case "delete-comment": {
      const thread = threadToChange(state, action.threadId, action.version);
      if (!thread.comments.some((c) => c.id === action.commentId)) throw new DomainError("That comment's gone");
      thread.comments = thread.comments.filter((c) => c.id !== action.commentId);
      thread.version++;
      // Its last comment takes the thread with it.
      if (!thread.comments.length) state.threads = state.threads!.filter((t) => t.id !== thread.id);
      return { message: "Comment deleted", entityId: thread.id };
    }
    case "resolve-thread": {
      const thread = threadToChange(state, action.threadId, action.version);
      if (action.resolved) thread.resolvedAt = isoTime(action.at); else delete thread.resolvedAt;
      thread.version++;
      return { message: action.resolved ? "Resolved" : "Reopened", entityId: thread.id };
    }
    case "set-page-icon": {
      const p = page(state, action.pageId);
      if (action.icon !== null && !isPageIcon(action.icon)) throw new DomainError("That isn't one emoji or picture");
      const had = Boolean(p.icon);
      if (action.icon === null) delete p.icon; else p.icon = action.icon;
      if (isRow(state, p)) p.editedAt = isoTime(undefined);
      return { message: action.icon === null ? "Icon removed" : had ? "Icon changed" : "Icon added", entityId: p.id };
    }
    case "set-page-cover": {
      const p = page(state, action.pageId);
      if (action.cover !== null && !isCoverLink(action.cover)) throw new DomainError("That isn't an image link");
      const had = p.cover, moved = action.cover !== null && action.cover === had;
      if (action.cover === null) { delete p.cover; delete p.coverPosition; } else {
        p.cover = action.cover;
        if (action.position !== undefined) p.coverPosition = coverPlace(action.position); else if (!moved) delete p.coverPosition;
      }
      if (isRow(state, p)) p.editedAt = isoTime(undefined);
      return { message: action.cover === null ? "Cover removed" : moved ? "Cover moved" : had ? "Cover changed" : "Cover added", entityId: p.id };
    }
    case "move-page": {
      const refusal = moveRefusal(state, action.pageId, action.parentId, action.beforeId);
      if (refusal) throw new DomainError(refusal);
      const before = moveBefore(state, action.pageId, action.parentId, action.beforeId);
      const index = state.pages.findIndex((p) => p.id === action.pageId);
      const [moved] = state.pages.splice(index, 1);
      const reordered = (moved!.parentId ?? null) === action.parentId;
      if (action.parentId) moved!.parentId = action.parentId; else delete moved!.parentId;
      // Its home block stays in the old parent as a view of it; here it is a full page until he turns it into inline.
      if (moved!.database && !reordered) moved!.database.homeBlockId = null;
      // Sibling order is page-list order, so the page goes just before its new next sibling, or at the end.
      state.pages.splice(before ? state.pages.indexOf(before) : state.pages.length, 0, moved!);
      return { message: action.parentId || reordered ? "Page moved" : "Moved to top level", entityId: moved!.id };
    }
    case "delete-page": {
      const p = page(state, action.pageId);
      if (p.type !== "document" && p.type !== "daily") throw new DomainError("This page can't be deleted");
      if (isTrashed(p)) throw new DomainError("Page is in trash");
      if (!Number.isFinite(Date.parse(action.at))) throw new DomainError("Invalid time");
      const rows = isDatabase(p) ? databaseRows(state, p.id).length : 0;
      const subItems = subItemsGoing(state, p).length;
      // A database's rows go with it, and aren't subpages he'd count.
      const n = trashSubtree(state, p, action.at, operationId).filter((x) => !databaseOfRow(state, x)).length - 1;
      if (isDatabase(p)) return { message: rows ? `Moved to trash · ${rows} row${rows === 1 ? "" : "s"}` : "Moved to trash", entityId: p.id };
      if (subItems) return { message: `Moved to trash · ${subItems} sub-item${subItems === 1 ? "" : "s"}`, entityId: p.id };
      return { message: n ? `Moved to trash · ${n} subpage${n === 1 ? "" : "s"}` : "Moved to trash", entityId: p.id };
    }
    case "restore-page": {
      const p = page(state, action.pageId);
      if (!isTrashed(p)) throw new DomainError("Page is not in trash");
      const ids = restoreSetOf(state, p);
      // A row whose database is in the trash restores the database too (design §12), never a row on its own.
      const db = databaseOfRow(state, p);
      const withDatabase = Boolean(db && isTrashed(db));
      if (db && withDatabase) for (const id of restoreSetOf(state, db)) ids.add(id);
      const { toTopLevel, joined } = restorePages(state, ids);
      if (joined) return { message: "Restored · joined with the new page", entityId: p.id };
      if (withDatabase) return { message: `Restored with ${db!.title.trim() || "Untitled"}`, entityId: p.id };
      return { message: toTopLevel.length ? "Restored to Pages" : "Restored", entityId: p.id };
    }
    case "restore-batch": {
      const ids = new Set(state.pages.filter((x) => isTrashed(x) && x.trashId === action.trashId).map((x) => x.id));
      if (!ids.size) throw new DomainError("Nothing left to restore");
      const batch = new Set(ids);
      // Rows whose database is in the trash bring it back too (design §12), never land at the top level on their own.
      const databases = new Set<Page>();
      for (const id of ids) { const db = databaseOfRow(state, state.pages.find((x) => x.id === id)!); if (db && isTrashed(db) && !ids.has(db.id)) databases.add(db); }
      for (const db of databases) for (const id of restoreSetOf(state, db)) ids.add(id);
      const { pages, toTopLevel, joined } = restorePages(state, ids);
      if (joined) return { message: "Restored · joined with the new page", entityId: pages.find((x) => x.type === "daily")!.id };
      const batchTop = pages.find((x) => batch.has(x.id) && (!x.parentId || !batch.has(x.parentId)))!;
      if (databases.size) return { message: `Restored with ${[...databases][0]!.title.trim() || "Untitled"}`, entityId: batchTop.id };
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
      if (action.databaseId) {
        const db = databasePage(state, action.databaseId);
        if (db.database.fixed) throw new DomainError("To-dos don't have templates");
        state.pages.push({ id, type: "template", date: null, title, parentId: rowTemplateTarget(db.id), document: JSON.stringify(nodes) });
        return { message: "Template saved", entityId: id };
      }
      if (action.dayPage) for (const t of state.pages) if (isTemplate(t) && t.parentId === dayPagesTarget) delete t.parentId;
      state.pages.push({ id, type: "template", date: null, title, ...(action.dayPage ? { parentId: dayPagesTarget } : {}), document: JSON.stringify(nodes) });
      return { message: "Template saved", entityId: id };
    }
    case "set-template-target": {
      const p = page(state, action.pageId);
      if (!isTemplate(p) || rowTemplateDatabaseId(p)) throw new DomainError("Not a template");
      const target = action.target;
      let where = "";
      if (target === dayPagesTarget) where = "day pages";
      else if (target === daySubpagesTarget) where = "pages inside days";
      else if (target === topLevelTarget) where = "top-level pages";
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
    case "set-draft": {
      // B77: the server's draft for a day page, checked here (ids it may use, planning part only) before it is kept.
      const day = page(state, action.pageId);
      if (day.type !== "daily" || isTrashed(day)) throw new DomainError("Not a day page");
      const allowed = new Set(action.allowedTaskIds);
      const old = draftOf(state, day.id);
      // One draft per day; the first ready one wins (Lead 98cb503a). A failed one (fallback only) is replaced only
      // until his first Apply or Skip on it (Jazz 283476c5, Bumblebee 8666b96e); after that it is the day's draft.
      // One a newer recipe makes again (Brian 3d7aca46) replaces it only when ready, and keeps what he applied or skipped.
      const recipe = action.recipe ?? 1;
      if (old && (!draftReplaceable(old, recipe) || (draftSettled(old) && action.status !== "ready"))) throw new DomainError("This day already has its draft");
      const items = remadeItems(old, normalizeDraftItems(state, day, action.items, allowed));
      // A to-do he already applied or skipped from the day's draft isn't offered again under "more open" (Ratchet ea6ab2bd).
      const decided = new Set(items.flatMap((i) => (i.state !== "open" && i.taskId ? [i.taskId] : [])));
      const moreOpen = action.moreOpen.filter((id) => allowed.has(id) && !decided.has(id));
      const draft: DayDraft = { status: action.status, items, moreOpen, ...(action.recipe ? { recipe: action.recipe } : {}) };
      const existing = state.pages.find((p) => p.id === draftPageId(day.id));
      if (existing) existing.document = JSON.stringify(draft);
      else state.pages.push({ id: draftPageId(day.id), type: "draft", date: null, title: "", parentId: day.id, document: JSON.stringify(draft) });
      return { message: "Draft ready", entityId: draftPageId(day.id) };
    }
    case "apply-draft": {
      // B77 (Ratchet 971bbb1): one operation, one Undo, for the rows, the tasks' plans and the bands' state. Each item
      // is checked against the page and the tasks as they are now; one that can't be placed safely stays open.
      const day = page(state, action.pageId);
      if (day.type !== "daily" || !day.date || isTrashed(day)) throw new DomainError("Not a day page");
      const draft = draftOf(state, day.id);
      if (!draft) throw new DomainError("No draft for this day");
      const wanted = new Set(action.itemIds);
      let doc = docOf(day), applied = 0;
      const after = new Map<string, string>();
      const plan: Task[] = [];
      for (const item of draft.items) {
        if (!wanted.has(item.id) || item.state !== "open") continue;
        const t = item.taskId ? state.tasks.find((x) => x.id === item.taskId) : undefined;
        if (item.taskId && (!eligibleTask(t) || rowIdsOf(doc, t.id).size)) continue;
        const at = placeItem(doc, { ...item, anchor: after.get(item.anchor) ?? item.anchor, place: after.has(item.anchor) ? "after" : item.place }, new Set(state.tasks.map((x) => x.id)));
        if (!at) continue;
        const words = action.edits?.[item.id]?.trim();
        let row: EditorNode;
        if (t) { row = planRow(t, day.date); plan.push(t); }
        else if (item.block?.type === "task") {
          const fresh = createTask(state, words || inlineText(item.block.content), day, day.date);
          row = planRow(fresh, day.date);
        } else row = { id: `${broughtPrefix}${newId()}`, type: item.block!.type, props: {}, content: words ? [textRun(words)] : structuredClone(item.block!.content), children: [] };
        // A fill keeps the slot's block id, so the other bands anchored on that slot stay right after it.
        if (at.kind === "fill") doc[at.index] = { ...row, id: doc[at.index]!.id };
        else doc.splice(at.index, 0, row);
        after.set(item.anchor, at.kind === "fill" ? doc[at.index]!.id : row.id);
        item.state = "applied";
        applied++;
      }
      if (!applied) throw new DomainError("Nothing to apply");
      setDocument(day, doc);
      for (const t of plan) planOn(state, t, day.date, { today: action.today });
      setDraft(state, day.id, draft);
      return { message: applied === 1 ? "Applied" : `Applied ${applied}`, entityId: draftPageId(day.id) };
    }
    case "skip-draft": {
      const day = page(state, action.pageId);
      const draft = draftOf(state, day.id);
      if (!draft) throw new DomainError("No draft for this day");
      const wanted = new Set(action.itemIds);
      let skipped = 0;
      for (const item of draft.items) if (wanted.has(item.id) && item.state === "open") { item.state = "skipped"; skipped++; }
      if (!skipped) throw new DomainError("Nothing to skip");
      setDraft(state, day.id, draft);
      return { message: skipped === 1 ? "Skipped" : `Skipped ${skipped}`, entityId: draftPageId(day.id) };
    }
    case "create-database": {
      const id = action.pageId;
      if (reservedTargets.has(id)) throw new DomainError("Page id already in use");
      const parentId = action.parentId ?? null;
      const existing = state.pages.find((p) => p.id === id);
      if (existing) {
        if (!isDatabase(existing) || (existing.parentId ?? null) !== parentId) throw new DomainError("Page id already in use");
        return { message: "Database made", entityId: id };
      }
      if (parentId !== null) pageParent(state, parentId);
      if (action.homeBlockId !== null && (typeof action.homeBlockId !== "string" || !action.homeBlockId || parentId === null)) throw new DomainError("Invalid database block");
      state.pages.push({ id, type: "document", date: null, title: text(action.title, 1000).trim(), ...(parentId ? { parentId } : {}), document: "[]", database: newDatabase(action.homeBlockId) });
      return { message: "Database made", entityId: id };
    }
    case "answer-form": {
      const p = state.pages.find((x) => x.id === action.databaseId);
      const view = p && isDatabase(p) && !isTrashed(p) ? p.database.views.find((v) => v.id === action.viewId) : undefined;
      const form = view ? formOf(view) : null;
      // Closed, deleted, in Trash or never there all read the same (forms.md §2, G7-7).
      if (!p?.database || !view || !form || form.closed) throw new DomainError("This form is closed");
      // Only what's asked given the answers: a hidden question isn't required, and its answer isn't kept (G7-6).
      const questions = askedQuestions(liveQuestions(p.database, form, titleId), action.values), asked = new Set(questions.map((q) => q.propertyId));
      // A question removed while it was open: the others are sent. One made required since: it's asked for (§4).
      const values = Object.fromEntries(Object.entries(action.values).filter(([id]) => asked.has(id) && id !== titleId));
      const title = asked.has(titleId) ? text(action.title, 1000).trim() : "";
      const missing = questions.find((q) => q.required && (q.propertyId === titleId ? !title : isEmptyAnswer(values[q.propertyId])));
      if (missing) throw new DomainError(`Needs an answer: ${missing.wording.trim() || "a question"}`);
      const over = questions.find((q) => q.max && Array.isArray(values[q.propertyId]) && (values[q.propertyId] as Json[]).length > q.max);
      if (over) throw new DomainError(`${over.wording.trim() || "A question"}: ${over.max} at most`);
      // An add-row, so it fires Row added and shows in every view (§4).
      execute(state, { type: "add-row", databaseId: p.id, pageId: action.pageId, title, values, at: action.at }, operationId);
      view.form = { ...form, responses: (form.responses ?? 0) + 1 };
      return { message: "Sent", entityId: action.pageId };
    }
    case "change-database": {
      // To-dos' rules: the same changes, on the workspace (automations.md §7). Nothing else of To-dos is stored.
      if (action.pageId === todosSourceId) {
        if (!/Automation/.test(action.change?.kind ?? "")) throw new DomainError("To-dos can't change that");
        const page = { id: todosSourceId, database: ruleDatabase(state, todosSourceId) } as Page & { database: Database };
        try { const message = changeDatabase(state, page, action.change); setRulesIn(state, todosSourceId, page.database.automations ?? []); if (state.todoAutomations?.length) delete state.todoAutomationsUnreadable; return { message, entityId: todosSourceId }; } catch (error) { throw new DomainError((error as Error).message); }
      }
      const p = databasePage(state, action.pageId);
      // A dashboard's commands read each widget's source as it is now: To-dos', or a database page that isn't in Trash.
      const sourceOf = (id: string) => { if (id === todosSourceId) return todosDatabase; const q = state.pages.find((x) => x.id === id); return isDatabase(q) && !isTrashed(q) ? q.database : null; };
      try { return { message: isDashboardChange(action.change) ? changeDashboard(p.database, action.change, sourceOf) : changeDatabase(state, p, action.change), entityId: p.id }; } catch (error) { throw new DomainError((error as Error).message); }
    }
    case "run-repeats": {
      const skipped: Array<{ title: string; earlier: string; full?: true }> = [];
      let made = 0;
      for (const { database, template, dates, skipped: missed } of dueRepeats(state, action.today, action.time)) {
        const repeat = database.database.repeats![template.id]!;
        let noRoom = 0;
        for (const date of dates.slice(0, databaseLimits.repeatsAtOnce)) {
          const pageId = repeatRowId(template.id, date);
          // A row he's deleted since, or one another tab just made, stays as it is.
          if (!state.pages.some((p) => p.id === pageId)) {
            if (databaseRows(state, database.id).length < 10_000) {
              execute(state, { type: "add-row", databaseId: database.id, pageId, title: template.title, template: template.id, at: action.at }, operationId);
              made++;
            } else noRoom++;
          }
          // On past a full database too, so its one notice doesn't come back on every open.
          repeat.last = date;
          repeat.lastRan = action.at;
        }
        if (noRoom) skipped.push({ title: template.title.trim() || "Untitled", earlier: periodWord(repeat, noRoom, ""), full: true });
        if (missed) skipped.push({ title: template.title.trim() || "Untitled", earlier: periodWord(repeat, missed) });
      }
      const rules = runScheduledRules(state, action, operationId);
      return { message: made ? `${made} repeating row${made === 1 ? "" : "s"} made` : "Nothing due", ...(skipped.length ? { skippedRepeats: skipped } : {}), ...(rules ? { automations: rules } : {}) };
    }
    case "run-button": return runButton(state, action, operationId);
    case "run-row-button": return runRowButton(state, action, operationId);
    case "add-row": {
      const db = databasePage(state, action.databaseId);
      const at = isoTime(action.at);
      const existing = state.pages.find((p) => p.id === action.pageId);
      if (existing) {
        if (existing.parentId !== db.id) throw new DomainError("Page id already in use");
        return { message: "Row added", entityId: existing.id };
      }
      if (reservedTargets.has(action.pageId)) throw new DomainError("Page id already in use");
      if (databaseRows(state, db.id).length >= 10_000) throw new DomainError("Too many rows");
      const source = action.copyOf ? rowPage(state, action.copyOf) : undefined;
      if (source && source.db.id !== db.id) throw new DomainError("Not a row");
      const template = action.template ? state.pages.find((p) => p.id === action.template) : undefined;
      if (action.template && (!template || rowTemplateDatabaseId(template) !== db.id)) throw new DomainError("That template's gone");
      let values: Page["values"];
      try { values = source ? structuredClone(source.row.values) : newRowStored(db.database, action.values); } catch (error) { throw new DomainError((error as Error).message); }
      // What the view's filter or the group asks for wins: it's what keeps the row where he added it.
      if (template) {
        const merged = { ...structuredClone(templateValues(template)), ...values };
        // A row linked from the template may have gone since.
        for (const p of db.database.properties) {
          const raw = merged[p.id];
          if (p.type !== "relation" || !Array.isArray(raw)) continue;
          const live = (raw as string[]).filter((id) => state.pages.some((x) => x.id === id && x.parentId === p.target && !isTrashed(x)));
          if (live.length) merged[p.id] = live; else delete merged[p.id];
        }
        if (Object.keys(merged).length) values = merged;
      }
      const row: Page = { id: action.pageId, type: "document", date: null, title: source ? `${source.row.title} (copy)`.trim() : text(action.title, 1000).trim(), parentId: db.id, ...lookOf(source?.row ?? template), document: JSON.stringify([emptyLine("paragraph")]), ...(values ? { values } : {}), createdAt: at, editedAt: at };
      if (source) row.document = JSON.stringify(copiedBody(state, source.row, row, localDay(state, at)));
      if (template) {
        if (!row.title) row.title = template.title;
        // A template's to-dos are words until now; each new row's are its own tasks (R3-12).
        row.document = JSON.stringify(pageFromTemplate(template, null, (n) => {
          const words = inlineText(n.content).trim();
          if (!words) return emptyTaskRow(null);
          const task = createTask(state, words, row, localDay(state, at));
          return { id: newId(), type: "task", props: { taskId: task.id, role: "reference", planDate: "" }, content: structuredClone(n.content), children: [] };
        }, (n) => isOriginalBlock(state, n)));
      }
      // A copy's sub-items are copies of its own, below: the originals stay with the row they're under.
      const tree = db.database.subItems;
      if (source && tree && row.values) { const { [tree.sub]: _theirs, ...kept } = row.values; if (Object.keys(kept).length) row.values = kept; else delete row.values; }
      numberNewRow(db.database, row);
      // A new row's links show on their other side, a copy's too.
      for (const p of db.database.properties) { const raw = row.values?.[p.id]; if (p.type === "relation" && Array.isArray(raw)) syncMirror(state, p, row.id, [], raw as string[], at); }
      // Rows keep page order: before `beforeId`, after the row it copies, or at the end.
      const rows = databaseRows(state, db.id);
      const before = action.beforeId ? rows.find((r) => r.id === action.beforeId) : source ? rows[rows.indexOf(source.row) + 1] : undefined;
      if (action.beforeId && !before) throw new DomainError("Row not found");
      state.pages.splice(before ? state.pages.indexOf(before) : state.pages.length, 0, row);
      if (source && tree) copySubItems(state, db, tree, source.row, row, localDay(state, at), at);
      return { message: source ? "Row duplicated" : "Row added", entityId: row.id };
    }
    case "move-row": {
      const { row, db: from } = rowPage(state, action.pageId);
      const to = databasePage(state, action.databaseId);
      if (to.id === from.id) throw new DomainError("Already there");
      if (to.database.fixed) throw new DomainError("To-dos can't take rows from another database");
      if (movesIntoItself(state, row, from, to)) throw new DomainError("That database is inside this row");
      if (databaseRows(state, to.id).length + rowMoveTree(state, row, from).length > 10_000) throw new DomainError(`${to.title.trim() || "That database"} is full`);
      applyRowMove(state, row, from, to, isoTime(action.at), newId);
      return { message: `Moved to ${to.title.trim() || "Untitled"}`, entityId: row.id };
    }
    case "add-rows": {
      // An import: every row in one operation, so one Undo takes them all (csv design §5).
      addRows(state, databasePage(state, action.databaseId), action.rows, isoTime(action.at));
      return { message: `${action.rows.length} rows added`, entityId: action.databaseId };
    }
    case "import-csv": {
      // A new database or an existing one, its new properties and its rows, in one operation: one Undo takes them all (csv design §5).
      if (action.create) {
        const { parentId = null, homeBlockId, title } = action.create;
        if (state.pages.some((p) => p.id === action.databaseId) || reservedTargets.has(action.databaseId)) throw new DomainError("Page id already in use");
        if (parentId !== null) pageParent(state, parentId);
        state.pages.push({ id: action.databaseId, type: "document", date: null, title: text(title, 1000).trim(), ...(parentId ? { parentId } : {}), document: "[]", database: newDatabase(homeBlockId) });
      }
      const db = databasePage(state, action.databaseId);
      // On the same question the preview asked, as the workspace may have grown since.
      const refusal = importRefusal(state, action.rows);
      if (refusal) throw new DomainError(refusal);
      try { for (const change of action.changes) changeDatabase(state, db, change); } catch (error) { throw new DomainError((error as Error).message); }
      addRows(state, db, action.rows, isoTime(action.at));
      return { message: `${action.rows.length} rows imported`, entityId: db.id };
    }
    case "paste-cells": {
      // A grid from a spreadsheet: the cells it lands on and the rows it needs, with one Undo (csv design §3).
      const at = isoTime(action.at);
      if (new Set(action.items.map((i) => i.pageId)).size !== action.items.length) throw new DomainError("Invalid rows");
      for (const item of action.items) {
        if (rowPage(state, item.pageId, true).db.id !== action.databaseId) throw new DomainError("Not a row");
        rowEdit(state, item, at);
      }
      addRows(state, databasePage(state, action.databaseId), action.rows, at);
      return { message: "Pasted", entityId: action.databaseId };
    }
    case "set-values": {
      // On that day's page, made from his template if need be, as `+ New` in To-dos does (R2-11). A resend finds it made already.
      for (const todo of action.newTodos ?? []) {
        if (!state.tasks.some((t) => t.id === todo.id)) addTask(state, ensureDay(state, todo.on), { title: todo.title, plannedOn: todo.on, id: todo.id });
      }
      const shifted = rowEdit(state, action, isoTime(action.at));
      if (action.beforeId !== undefined) {
        const row = page(state, action.pageId);
        // Before a row that's gone meanwhile: the end, as `move-page`'s drag does.
        const before = moveBefore(state, row.id, row.parentId ?? null, action.beforeId);
        state.pages.splice(state.pages.indexOf(row), 1);
        state.pages.splice(before ? state.pages.indexOf(before) : state.pages.length, 0, row);
      }
      return { message: "Saved", entityId: action.pageId, ...(shifted.length ? { shifted } : {}) };
    }
    case "set-values-many": {
      const at = isoTime(action.at);
      if (!Array.isArray(action.items) || !action.items.length || action.items.length > databaseLimits.rowsAtOnce) throw new DomainError("Invalid rows");
      if (new Set(action.items.map((i) => i.pageId)).size !== action.items.length) throw new DomainError("Invalid rows");
      const shifted = action.items.flatMap((item) => rowEdit(state, item, at));
      return { message: `Saved ${action.items.length} rows`, ...(shifted.length ? { shifted: [...new Set(shifted)] } : {}) };
    }
    case "edit-todos": {
      if (!Array.isArray(action.items) || !action.items.length || action.items.length > databaseLimits.todosAtOnce) throw new DomainError("Invalid to-dos");
      if (new Set(action.items.map((i) => i.taskId)).size !== action.items.length) throw new DomainError("Invalid to-dos");
      const today = date(action.today);
      let changed = 0, couldnt = 0, because: string | undefined;
      for (const { taskId, changes } of action.items) {
        if (!changes.length || changes.some((c) => !todoBarColumns.has(c.columnId))) throw new DomainError("Invalid to-dos");
        // Gone since this tab read it: one that couldn't, not a reason to refuse the rest.
        if (!state.tasks.some((t) => t.id === taskId)) { couldnt++; continue; }
        let did = false, refused = false;
        // Each reads what the last one left, as a single edit would: planning one that's just been reopened, say (#92).
        for (const move of todoMoves(state, taskId, changes.map((c) => ({ id: c.columnId, value: c.value ?? undefined })))) {
          const change = todoChange(state, taskId, move.id, move.value, today);
          if (!change) continue;
          if ("refused" in change) { refused = true; because ??= change.refused; continue; }
          execute(state, change.action, operationId);
          did = true;
        }
        if (did) changed++;
        else if (refused) couldnt++;
      }
      if (!changed) throw new NoTodoChanged(because ?? (couldnt ? "Those to-dos are gone" : "Nothing to change"));
      return { message: `${changed} to-do${changed === 1 ? "" : "s"} changed${couldnt ? ` · ${couldnt} couldn't` : ""}` };
    }
    case "delete-pages": {
      const at = isoTime(action.at);
      const pages = action.pageIds.map((id) => page(state, id));
      if (!pages.length || pages.length > databaseLimits.rowsAtOnce || new Set(action.pageIds).size !== pages.length) throw new DomainError("Invalid pages");
      for (const p of pages) { if (p.type !== "document") throw new DomainError("Day pages can't be deleted"); if (isTrashed(p)) throw new DomainError("Page is in trash"); }
      const byId = new Map(state.pages.map((x) => [x.id, x]));
      const rows = pages.every((p) => { const parent = p.parentId ? byId.get(p.parentId) : undefined; return isDatabase(parent); });
      const going = trashTogether(state, pages, at, operationId);
      const n = pages.length;
      return { message: `${n} ${rows ? (n === 1 ? "row" : "rows") : n === 1 ? "page" : "pages"} moved to trash${going ? ` · ${going} sub-item${going === 1 ? "" : "s"}` : ""}` };
    }
    case "set-timezone":
      state.timezone = validTimezone(action.timezone);
      return { message: "Time zone saved" };
    case "set-week-start":
      if (action.weekStart === 1) state.weekStart = 1; else delete state.weekStart;
      return { message: action.weekStart === 1 ? "Weeks start on Monday" : "Weeks start on Sunday" };
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
  let result: { automations?: NonNullable<Receipt["automations"]>; message: string; entityId?: string; renamed?: Record<string, string>; conflicted?: string[]; linesRemovedFrom?: number; shifted?: string[]; skippedRepeats?: Array<{ title: string; earlier: string; full?: true }> };
  if (command.action.type === "undo") {
    const previous = input.undo;
    if (!previous?.before || previous.operationId !== command.action.targetOperationId || previous.revision !== input.revision) throw new DomainError("Cannot undo after later changes; current values kept");
    // Taking away a page made by that change would take the notes written on it since.
    const pagesBack = new Set(previous.before.pages.map((p) => p.id));
    if (input.threads?.some((t) => !pagesBack.has(t.pageId))) throw new DomainError("Cannot undo after later changes; current values kept");
    state = expandedWorkspace({ ...structuredClone(previous.before), revision: input.revision, receipts: structuredClone(input.receipts) });
    keepRowNumbers(input, state);
    result = { message: "Previous operation restored" };
  } else {
    result = execute(state, command.action, command.operationId);
    // A block's lines changed by this command take its time as their Edited time (Ratchet cf5f7beb).
    const at = (command.action as { at?: unknown }).at;
    result = { ...result, ...settleSynced(state, typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : undefined) };
    const fired = firedRules(input, state, command.action, { today: localDay(state, isoTime(undefined)), pageDate: null, zone: state.timezone }, () => todoSources(input, state));
    if (fired.length) { const run = runAutomations(state, fired, command.operationId); state = run.state; result = { ...result, automations: run.automations }; }
  }
  state.revision = input.revision + 1;
  const receipt = { operationId: command.operationId, ...result, fingerprint };
  state.receipts = compactReceipts({ ...state.receipts, [command.operationId]: receipt });
  // A line cut and pasted to another page keeps its id, so its thread goes with it: only when its own page no longer has it, or a copy could take it (comments.md §4).
  if (command.action.type === "save-editor" && state.threads?.some((t) => t.anchor)) {
    const savedTo = command.action.pageId, here = state.pages.find((p) => p.id === savedTo), ids = here ? new Set(flatNodes(pageNodes(here)).map((n) => n.id)) : null;
    for (const thread of state.threads) {
      if (!ids || !thread.anchor || thread.pageId === savedTo || !ids.has(thread.anchor.blockId)) continue;
      const home = state.pages.find((p) => p.id === thread.pageId);
      if (!home || !flatNodes(pageNodes(home)).some((n) => n.id === thread.anchor!.blockId)) thread.pageId = savedTo;
    }
  }
  // A shared line whose sharing has ended: its thread stays on the line in the page it was made on if that's still there, and otherwise goes to the first place left, whose line is ordinary now (comments.md §4).
  for (const thread of state.threads ?? []) {
    const anchor = thread.anchor;
    if (!anchor || anchor.taskId) continue;
    const home = state.pages.find((p) => p.id === thread.pageId);
    // Still shared, but its home's place has gone: the thread stays with the shared lines, and that page's line is ordinary now.
    if (recordOfLine(state, anchor.blockId)) {
      if (!home || !lineIdsOnPage(home, anchor.blockId, true).length) { const next = livePages(state).find((p) => lineIdsOnPage(p, anchor.blockId, true).length); if (next) thread.pageId = next.id; }
      continue;
    }
    if (home && flatNodes(pageNodes(home)).some((n) => n.id === anchor.blockId)) continue;
    const stem = `${anchor.blockId}:`, left = livePages(state).flatMap((p) => flatNodes(pageNodes(p)).filter((n) => n.id.startsWith(stem)).map((n) => ({ page: p, id: n.id })))[0];
    if (left) { thread.pageId = left.page.id; anchor.blockId = left.id; }
  }
  // A to-do planned to another day is a new line there, so a thread on it goes to that line. Its plan row if it has one, as that's where the to-do is now (Roadbuster, #158).
  for (const thread of state.threads ?? []) {
    const anchor = thread.anchor;
    if (!anchor?.taskId) continue;
    const home = state.pages.find((p) => p.id === thread.pageId);
    if (home && flatNodes(pageNodes(home)).some((n) => n.id === anchor.blockId)) continue;
    const rows = taskRows(state, anchor.taskId), row = rows.find((r) => r.role === "plan") ?? rows[0];
    if (row) { thread.pageId = row.page.id; anchor.blockId = row.node.id; }
  }
  // A page gone for good takes its threads with it. In Trash they wait for it.
  if (state.threads?.length) { const held = new Set(state.pages.map((p) => p.id)); state.threads = state.threads.filter((t) => held.has(t.pageId)); }
  if (state.threads && !state.threads.length) delete state.threads;
  if (leavesUndoAlone(command.action.type)) {
    // A note isn't worth Undo, and shouldn't cost the Undo of a table deleted before it (comments.md §2). That Undo brings back what it changed and leaves the note.
    // If what it changed was comments, it would bring back a thread from before the note, so it goes.
    const previous = input.undo;
    if (previous && (!previous.before || JSON.stringify(previous.before.threads ?? []) === JSON.stringify(input.threads ?? []))) state.undo = { ...previous, revision: state.revision, ...(previous.before ? { before: { ...previous.before, threads: state.threads } } : {}) };
    else delete state.undo;
  } else if (!["undo", "ensure-day", "run-repeats"].includes(command.action.type)) state.undo = { operationId: command.operationId, revision: state.revision, before };
  else delete state.undo;
  return { workspace: state, receipt };
}
