// Databases (docs/design/databases-model.md): a database is a page with `database` (its properties and views); a row
// is a child page with `values`. Values are read through their property, never trusted as stored, so a schema change
// rewrites only the database page. Pure: the domain's commands and the browser's views share it.
import { rowTemplateTarget } from "./day-template.ts";
import { formulaProblem, rollupProblem, worldOf } from "./formula.ts";
import type { LocalDate, Page, WeekStart, Workspace } from "./types.ts";

export const propertyTypes = ["text", "number", "select", "multiSelect", "status", "date", "checkbox", "url", "email", "phone", "createdTime", "editedTime", "id", "relation", "rollup", "formula", "files"] as const;
export type PropertyType = (typeof propertyTypes)[number];
export type NumberFormat = "plain" | "comma" | "percent" | "currency";
export type StatusGroup = "todo" | "active" | "done";

export interface Option {
  id: string;
  name: string;
  /** status only */
  group?: StatusGroup;
  /** Made from Text (R3-16): the words it stands for, folded. The rows keep their words, so changing back restores them, and a rename doesn't lose its rows. */
  from?: string;
}
export interface Property {
  /** Stable: renaming never rewrites values. Never `title`, which is the row page's title column. */
  id: string;
  name: string;
  type: PropertyType;
  /** select, multiSelect, status: the choices, in order. Kept when the type changes, so changing it back reads them again. */
  options?: Option[];
  format?: NumberFormat;
  /** date: whether a time is shown and asked for */
  withTime?: boolean;
  /** To-dos' Page: shown, never edited. */
  readOnly?: true;
  /** date, To-dos': one day, as a task's dates are: no end, no time. */
  dayOnly?: true;
  /** What clearing this means, where it's more than emptying a cell. */
  clearLabel?: string;
  /** relation: the database its rows point into (may be this one). */
  target?: string;
  /** relation: its other side, a relation on the target pointing back, kept in step by every write ("Show on Books"). */
  mirror?: string;
  /** relation: at most this many rows. Only 1 is offered, against no limit. */
  limit?: 1;
  /** rollup: what it reads through which relation. Worked out when read (relations.ts), never stored. */
  rollup?: Rollup;
  /** formula: its text, with properties by id. Stays when read: a column reads as the type it works out to, and this says it's a formula (formula.ts). */
  formula?: string;
  /** formula, as read, never stored: why the whole column reads Error. */
  formulaError?: string;
  /** relation, as read (relations.ts), never stored: its target's name, and whether that's in Trash. */
  targetTitle?: string;
  targetTrashed?: true;
  /** An ID's words before its number, "BK-" in BK-12: shown only, so changing it renumbers nothing (R3-9). */
  prefix?: string;
}
export interface DateValue { start: string; end?: string }
export const rollupFunctions = ["original", "unique", "countAll", "countValues", "countUnique", "countEmpty", "countNotEmpty", "percentEmpty", "percentNotEmpty", "sum", "average", "median", "min", "max", "range", "earliest", "latest", "dateRange", "checked", "unchecked", "percentChecked", "percentUnchecked"] as const;
export type RollupFunction = (typeof rollupFunctions)[number];
export interface Rollup { relation: string; property: string; fn: RollupFunction }
/** A fixed day, or one relative to today or to the day page the view is on, with an offset in days. */
export type DateRef = { date: LocalDate } | { relative: "today" | "pageDate"; offset?: number };
export const filterOpList = [
  "contains", "doesNotContain", "is", "isNot", "isEmpty", "isNotEmpty",
  "eq", "ne", "gt", "lt", "gte", "lte",
  "isAnyOf", "isNoneOf",
  "before", "after", "onOrBefore", "onOrAfter", "within",
] as const;
export type FilterOp = (typeof filterOpList)[number];
export type Within = "thisWeek" | "past7" | "next7";
/** What a stored value or a filter's value can be: plain JSON, so it travels and stores as it is. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export interface Condition { by: string; op: FilterOp; value?: Json }
export interface Sort { by: string; direction: "asc" | "desc" }
export type GroupDateBy = "day" | "week" | "month";
export const viewLayouts = ["table", "board", "list", "gallery", "calendar", "timeline"] as const;
export type ViewLayout = (typeof viewLayouts)[number];
/** Values a new row takes from a template: not its number, which is its own. */
export function templateValues(template: Pick<Page, "values">): NonNullable<Page["values"]> {
  const { [rowNumberKey]: _number, ...values } = template.values ?? {};
  return values;
}
export const calcKinds = ["countAll", "countValues", "countUnique", "countEmpty", "countNotEmpty", "percentEmpty", "percentNotEmpty", "sum", "average", "median", "min", "max", "range", "earliest", "latest", "dateRange", "checked", "unchecked", "percentChecked", "percentUnchecked", "countPerGroup", "percentPerGroup"] as const;
export type CalcKind = (typeof calcKinds)[number];
export interface BoardCalculation { by: string; kind: CalcKind }
export interface View {
  id: string;
  name: string;
  layout: ViewLayout;
  /** Shown properties, in order, with widths; one not listed is hidden. The title column is always shown first and is not listed. */
  columns: { id: string; width?: number; /** Long values run on to more lines, and the row grows (R3-14). */ wrap?: true }[];
  /** The same for Name, which is always shown and so isn't in `columns`. */
  wrapName?: true;
  sort: Sort[];
  /** All must hold, or any with `filterAny`. */
  filter: Condition[];
  /** "Any rule matches" (design §7.3, R3-4). */
  filterAny?: true;
  /** What `+ New` starts from in this view, over the database's own (R3-12). */
  defaultTemplate?: string;
  /** With sub-items on: nested in toggles (table, list) or flat; and which rows. Absent: nested, both. */
  subItemsDisplay?: SubItemsDisplay;
  /** Gallery: the Files property a card shows; the first image in the row's body when absent. */
  cardImage?: string;
  subItemsShow?: SubItemsShow;
  /** A table's foot: what each column adds up to, by column id (design §4.1a, R3-8). */
  calculations?: Record<string, CalcKind>;
  /** What a board's column heads show instead of their count: one per view (R3-24). */
  boardCalculation?: BoardCalculation;
  /** Table and list: their groups. Board: what makes its columns. Ignored while its property is deleted or can't group (design §13). */
  groupBy?: string;
  /** A date's groups; a month when absent. */
  groupDateBy?: GroupDateBy;
  hideEmptyGroups?: boolean;
  /** Group keys listed at the end as "Hidden: Done (12)". */
  hiddenGroups?: string[];
  /** A second layer inside each group, by another property (R3-13); read only while there's a first. `hideEmptyGroups` covers both. */
  subGroupBy?: string;
  subGroupDateBy?: GroupDateBy;
  hiddenSubGroups?: string[];
  /** Calendar: the date property its rows sit by. Ignored while it's deleted or no longer a date (design §13). */
  dateBy?: string;
  /** Calendar: a week at a time; a month when absent (R3-20). */
  calendarSpan?: "week";
  /** Timeline: a second date property its bars end on; a range in `dateBy` otherwise. */
  timelineEnd?: string;
  /** Timeline: the table beside the scale is showing. */
  timelineTable?: true;
  /** Timeline: the scale's unit; Day when absent. */
  timelineUnit?: "hours" | "day" | "week" | "month" | "quarter" | "year";
  /** Where a row opens from this view (R4-11); a full page when absent. */
  openIn?: "center" | "side";
  /** Colour by a value (R4-12): from the top, the first that matches wins. Nothing colours until he makes a rule. */
  colourRules?: ColourRule[];
  /** Table at 1280: this column and those to its left stay while the rest scroll (R4-13). */
  frozenThrough?: string;
  /** Table at 1280: Name's width, dragged on its head (R4-18); the default when absent. */
  nameWidth?: number;
}
export const tints = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type Tint = (typeof tints)[number];
/** One filter rule and a tint. `property`: only the rule's own cell, in a table; the whole row otherwise. */
export interface ColourRule { id: string; rule: Condition; tint: Tint; scope?: "property" }
export interface SubItems { parent: string; sub: string }
export type DependencyMode = "overlap" | "keep" | "none";
/** Dependencies are on: the two relations, the date they go by (one Date, or a start and an end), and how a shift behaves (sub-items design §3). */
export interface Dependencies { blockedBy: string; blocking: string; date: string; end?: string; mode: DependencyMode; avoidWeekends?: true }
export type SubItemsDisplay = "nested" | "flat";
export type SubItemsShow = "both" | "parents" | "subs";
/** A row template that makes a row every so often (R4-6), kept with the database, as what it makes lives there. */
export interface Repeat {
  every: "day" | "week" | "month" | "year";
  interval: number;
  start: LocalDate;
  /** Weekly only, 0 is Sunday: the days it makes a row on. The start's weekday when absent. */
  weekdays?: number[];
  /** HH:mm; the start of the day when absent. */
  time?: string;
  paused?: true;
  /** Make every period missed while he was away, not only the latest. */
  everyMissed?: true;
  /** When it was set up, YYYY-MM-DDTHH:mm: a start in the past doesn't reach back before this. */
  notBefore?: string;
  /** The last period it made, and when. */
  last?: LocalDate;
  lastRan?: string;
}
export interface Database {
  /** The `database` block that is its place in its parent page; null: shown as a full page. */
  homeBlockId: string | null;
  properties: Property[];
  /** At least one. */
  views: View[];
  /** To-dos: its properties and rows come from his tasks, so none can be added, changed or reordered here. Never stored. */
  fixed?: true;
  /** What `+ New` starts from in every view without its own (R3-12). */
  defaultTemplate?: string;
  /** Sub-items are on: which two self-relations make the tree (sub-items design §1). Turning them off clears this and keeps both. */
  subItems?: SubItems;
  dependencies?: Dependencies;
  /** Row templates that repeat, by template id. */
  repeats?: Record<string, Repeat>;
  /** The next row number, once an ID property has been made. It only goes up, past a delete or an undone add (R3-9). */
  nextRowNumber?: number;
}
export type RawValues = Record<string, Json>;
/** What a cell shows: the typed value, or null for empty (checkbox: false). */
export type CellValue = string | number | string[] | DateValue | boolean | FileValue[] | null;
/** One file in a Files cell (R3-11). The bytes are in the file store under its id; this travels with the row, so Undo, Trash and a moved row need nothing else. */
export interface FileValue { id: string; name: string; size: number; type: string; thumb?: string }
/** Whether anything here holds a file, Trash included. */
export const holdsFiles = (ws: Pick<Workspace, "pages">): boolean => ws.pages.some((p) => isDatabase(p) && p.database.properties.some((x) => x.type === "files" && databaseRowsOf(ws, p.id).some((r) => Array.isArray(r.values?.[x.id]) && (r.values![x.id] as unknown[]).length > 0)));
const databaseRowsOf = (ws: Pick<Workspace, "pages">, id: string) => ws.pages.filter((r) => r.parentId === id);
export const fileLimits = { size: 25 * 1024 * 1024, perCell: 50, account: 5 * 1024 * 1024 * 1024 };
const isFileValue = (x: unknown): x is FileValue => {
  const f = x as FileValue | null;
  return !!f && typeof f === "object" && typeof f.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(f.id) && typeof f.name === "string" && f.name.length > 0 && f.name.length <= 255 && Number.isInteger(f.size) && f.size >= 0 && f.size <= fileLimits.size && typeof f.type === "string" && f.type.length <= 100 && (f.thumb === undefined || (typeof f.thumb === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(f.thumb)));
};

/** The column id of a row's title, in views, sorts, filters and `set-values`. */
export const titleId = "title";
/** The `pageId` of a block showing To-dos, and a relation's target when it links tasks. No real page has it. */
export const todosSourceId = "source:tasks";
/** Where a row keeps its number, among its values: under no property, so changing a property's type never touches it. */
export const rowNumberKey = "@id";
/** The types the app fills in: they can't be typed, pasted, or set by a filter's `+ New` (R3-9). */
export const isReadOnlyType = (type: PropertyType): boolean => type === "createdTime" || type === "editedTime" || type === "id";
/** Nothing can be typed here: the app's own columns, a rollup, To-dos' Page. */
export const isReadOnly = (property: Property): boolean => isReadOnlyType(property.type) || Boolean(property.readOnly);
export const isTimeType = (type: PropertyType): boolean => type === "createdTime" || type === "editedTime";
const isTextType = (type: PropertyType): boolean => type === "text" || type === "url" || type === "email" || type === "phone";
/** A row's Created or Edited time as a date value; none on a row from before they were kept. */
export function rowTime(property: Property, row: Page): DateValue | null {
  const at = property.type === "editedTime" ? row.editedAt ?? row.createdAt : row.createdAt;
  return at ? { start: localWall(at) } : null;
}
/** An ISO time as a wall clock on this device: what a date cell holds, so a created time reads in local time. */
function localWall(iso: string): string {
  const d = new Date(iso), two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
export const databaseBlockType = "database";
export const limits = { formula: 10_000, properties: 100, options: 200, views: 50, conditions: 20, sorts: 10, text: 10_000, name: 200, multi: 100, rowsAtOnce: 10_000, repeatsAtOnce: 200, hiddenGroups: 200, prefix: 20 } as const;

export const isDatabase = (p: Page | undefined | null): p is Page & { database: Database } => Boolean(p?.database);
/** A row: a page whose parent is a database. */
export function databaseOfRow(ws: Workspace, p: Page): (Page & { database: Database }) | null {
  if (p.type !== "document" || !p.parentId) return null;
  const parent = ws.pages.find((x) => x.id === p.parentId);
  return isDatabase(parent) ? parent : null;
}
export const isRow = (ws: Workspace, p: Page): boolean => databaseOfRow(ws, p) !== null;
/** The database's live rows, in page order (the order `move-page` keeps). */
export function databaseRows(ws: Workspace, databaseId: string): Page[] {
  return ws.pages.filter((p) => p.parentId === databaseId && p.type === "document" && !isTrashed(p));
}

const isTrashed = (p: Page): boolean => Boolean(p.trashedAt);
const newId = (): string => crypto.randomUUID();
export function defaultView(name = "Table"): View {
  return { id: newId(), name, layout: "table", columns: [], sort: [], filter: [] };
}
/** The design's new database (§3.1): the title column only, one Table view, no rows. */
export function newDatabase(homeBlockId: string | null): Database {
  return { homeBlockId, properties: [], views: [defaultView()] };
}
/** A new Status property's choices, one per group, like Notion's. */
export function defaultStatusOptions(): Option[] {
  return [{ id: newId(), name: "Not started", group: "todo" }, { id: newId(), name: "In progress", group: "active" }, { id: newId(), name: "Done", group: "done" }];
}

// ---------------------------------------------------------------- values

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
function validDay(value: string): boolean {
  if (!dayPattern.test(value)) return false;
  const day = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` local wall time in the workspace's zone (like `@date` chips). */
export function validDateText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (dayPattern.test(value)) return validDay(value);
  if (!timePattern.test(value)) return false;
  const [h, m] = value.slice(11).split(":").map(Number);
  return validDay(value.slice(0, 10)) && h! < 24 && m! < 60;
}
const optionIdSets = new WeakMap<Option[], Set<string>>();
/** Kept per list: a relation's options are every row of its target, and this runs for each cell. */
function optionIds(p: Property): Set<string> {
  if (!p.options) return new Set();
  let ids = optionIdSets.get(p.options);
  if (!ids) { ids = new Set(p.options.map((o) => o.id)); optionIdSets.set(p.options, ids); }
  return ids;
}
function parseNumber(value: string): number | null {
  const s = value.trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const makesOptions = (old: Property, type: PropertyType) => isTextType(old.type) && (type === "select" || type === "multiSelect");
const textParts = (raw: string): string[] => raw.split(",").map((part) => part.trim()).filter(Boolean);
const optionFromText = (property: Property, raw: string): string | null => {
  const words = fold(raw.trim());
  return (words && property.options?.find((o) => o.from === words)?.id) || null;
};
/** Text to Select or Multi-select (R3-16): an option for each thing the rows say, in the order they say it, and for what's already an option by name. What won't fit stays in its row, reads as empty and is counted. */
function optionsFromText(ws: Workspace, databaseId: string, old: Property, type: PropertyType): Option[] {
  const options = [...(old.options ?? [])];
  for (const row of databaseRows(ws, databaseId)) {
    const raw = row.values?.[old.id];
    if (typeof raw !== "string") continue;
    for (const text of type === "multiSelect" ? textParts(raw) : [raw.trim()]) {
      const words = fold(text);
      if (!words || text.length > limits.name || options.some((o) => o.from === words)) continue;
      const named = options.findIndex((o) => fold(o.name) === words);
      if (named >= 0) { options[named] = { ...options[named]!, from: words }; continue; }
      if (options.length >= limits.options) continue;
      let n = options.length;
      while (options.some((o) => o.id === `${old.id}-o${n}`)) n++;
      options.push({ id: `${old.id}-o${n}`, name: text, from: words });
    }
  }
  return options;
}
/**
 * The value a cell shows, read from what the row stores. Where a type change makes the reading obvious (number and
 * text, select, status and multi-select by option id, text and url) it converts; anything else reads as empty, so
 * changing the type back shows the stored value again.
 */
export function readValue(property: Property, raw: unknown): CellValue {
  const ids = optionIds(property);
  switch (property.type) {
    // The app's own, read from the row by `cellValue`: nothing is stored under the property.
    case "createdTime":
    case "editedTime":
    case "id":
    case "rollup":
    case "formula":
      return null;
    case "files": {
      const files = Array.isArray(raw) ? raw.filter(isFileValue) : [];
      return files.length ? files : null;
    }
    case "text":
    case "url":
    case "email":
    case "phone": {
      if (typeof raw === "string") return raw === "" ? null : (property.options?.find((o) => o.id === raw)?.name ?? raw);
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
      // A date or a tick keeps its words as Text (R3-16). The other text types are addresses, which those aren't.
      if (property.type === "text" && raw === true) return "Yes";
      if (property.type === "text" && raw && typeof raw === "object" && !Array.isArray(raw) && validDateText((raw as DateValue).start)) { const { start, end } = raw as DateValue; return (validDateText(end) ? `${start} → ${end}` : start).replace(/T/g, " "); }
      if (Array.isArray(raw)) { const names = raw.map((id) => property.options?.find((o) => o.id === id)?.name).filter((x): x is string => Boolean(x)); return names.length ? names.join(", ") : null; }
      return null;
    }
    case "number":
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      return typeof raw === "string" ? parseNumber(raw) : null;
    case "select":
    case "status": {
      const picked = typeof raw === "string" ? (ids.has(raw) ? raw : optionFromText(property, raw)) : Array.isArray(raw) ? raw.find((x) => typeof x === "string" && ids.has(x)) ?? null : null;
      // The design (§6.1): a status always has a value, the first To-do option.
      if (picked === null && property.type === "status") return property.options?.find((o) => o.group === "todo")?.id ?? property.options?.[0]?.id ?? null;
      return picked;
    }
    // A relation's options are its target's rows (`withLinks`), so a link to a row that's gone reads without it, and comes back with it.
    case "relation":
    case "multiSelect": {
      const list = typeof raw === "string" ? (ids.has(raw) || property.type === "relation" ? [raw] : textParts(raw).flatMap((part) => optionFromText(property, part) ?? [])) : Array.isArray(raw) ? raw : [];
      const picked = [...new Set(list.filter((x): x is string => typeof x === "string" && ids.has(x)))];
      return picked.length ? picked : null;
    }
    case "date": {
      if (validDateText(raw)) return { start: raw };
      if (raw && typeof raw === "object" && !Array.isArray(raw) && validDateText((raw as DateValue).start)) {
        const { start, end } = raw as DateValue;
        return validDateText(end) && end >= start ? { start, end } : { start };
      }
      return null;
    }
    case "checkbox":
      return raw === true;
  }
}
export function isEmptyValue(value: CellValue): boolean {
  return value === null || value === false || (Array.isArray(value) && value.length === 0);
}

/**
 * What a cell edit stores for this property, checked: undefined clears it. Refuses what the type can't hold, so a
 * stored value is always one `readValue` reads back unchanged.
 */
export function storedValue(property: Property, input: unknown): Json | undefined {
  if (input === null || input === undefined) return undefined;
  const refuse = (): never => { throw new DatabaseError(`Not a value for ${property.name || "this property"}`); };
  switch (property.type) {
    case "createdTime":
    case "editedTime":
    case "id":
    case "rollup":
    case "formula":
      return refuse();
    case "files": {
      if (!Array.isArray(input) || input.length > fileLimits.perCell || !input.every(isFileValue)) refuse();
      const seen = new Set<string>();
      const files = (input as FileValue[]).filter((f) => !seen.has(f.id) && seen.add(f.id)).map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type, ...(f.thumb ? { thumb: f.thumb } : {}) }));
      return files.length ? (files as unknown as Json) : undefined;
    }
    case "relation": {
      if (!Array.isArray(input) || input.length > limits.multi) refuse();
      const list = [...new Set(input as unknown[])];
      if (!list.every((x) => typeof x === "string" && x.length <= 200)) refuse();
      // "1 page": the newest pick.
      const kept = property.limit === 1 ? list.slice(-1) : list;
      return kept.length ? (kept as string[]) : undefined;
    }
    case "text":
    case "url":
    case "email":
    case "phone": {
      if (typeof input !== "string" || input.length > limits.text) refuse();
      const s = (input as string).replace(/\u0000/g, "");
      return s === "" ? undefined : s;
    }
    case "number":
      if (typeof input !== "number" || !Number.isFinite(input)) refuse();
      return input as number;
    case "select":
    case "status":
      if (typeof input !== "string" || !optionIds(property).has(input)) refuse();
      return input as string;
    case "multiSelect": {
      if (!Array.isArray(input) || input.length > limits.multi) refuse();
      const ids = optionIds(property);
      const list = [...new Set(input as unknown[])];
      if (!list.every((x) => typeof x === "string" && ids.has(x))) refuse();
      return list.length ? (list as string[]) : undefined;
    }
    case "date": {
      const value = typeof input === "string" ? { start: input } : input as DateValue;
      if (!value || typeof value !== "object" || Array.isArray(value) || !validDateText(value.start)) refuse();
      const keys = Object.keys(value);
      if (keys.some((k) => k !== "start" && k !== "end")) refuse();
      if (value.end === undefined) return { start: value.start };
      if (!validDateText(value.end) || value.end < value.start) refuse();
      return { start: value.start, end: value.end };
    }
    case "checkbox":
      if (typeof input !== "boolean") refuse();
      return input ? true : undefined;
  }
}
export class DatabaseError extends Error {}

/** The same stored value, compared by content: what `set-values` checks its `expected` against. */
export function sameRaw(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return JSON.stringify(value);
}
/** A row's raw value for a column: the title for `title`, else its stored value. */
export function rawOf(row: Page, columnId: string): unknown {
  return columnId === titleId ? row.title : row.values?.[columnId];
}
const titleProperty: Property = { id: titleId, name: "Name", type: "text" };
/** The property a column, sort or filter names: the title column, or one of the database's; null when it was deleted. */
export function propertyOf(db: Database, id: string): Property | null {
  return id === titleId ? titleProperty : db.properties.find((p) => p.id === id) ?? null;
}
/** A row's value for a column, as its cell shows it. */
export function cellValue(db: Database, row: Page, columnId: string): CellValue {
  const property = propertyOf(db, columnId);
  if (!property) return null;
  if (property.type === "id") { const n = row.values?.[rowNumberKey]; return typeof n === "number" ? n : null; }
  if (isTimeType(property.type)) return rowTime(property, row);
  return readValue(property, rawOf(row, columnId));
}

/** The rows whose stored value for this property reads differently as `type`: the "N values show as empty" count. */
export function lostOnTypeChange(ws: Workspace, databaseId: string, property: Property, type: PropertyType): number {
  // A relation's options are its target's rows, so an old option's id isn't a link, whatever it matches.
  const options = type === "relation" && property.type !== "relation" ? [] : makesOptions(property, type) ? optionsFromText(ws, databaseId, property, type) : property.options;
  const next = { ...property, type, options };
  return databaseRows(ws, databaseId).filter((r) => {
    const raw = r.values?.[property.id];
    // Nothing but spaces isn't a value lost.
    return raw !== undefined && !(typeof raw === "string" && !raw.trim()) && !isEmptyValue(readValue(property, raw)) && isEmptyValue(readValue(next, raw));
  }).length;
}
/** Rows holding this option: the "removed from N rows" count. */
export function rowsWithOption(ws: Workspace, databaseId: string, property: Property, optionId: string): number {
  return databaseRows(ws, databaseId).filter((r) => {
    const v = readValue(property, r.values?.[property.id]);
    return v === optionId || (Array.isArray(v) && (v as string[]).includes(optionId));
  }).length;
}

// ---------------------------------------------------------------- views: filter and sort

export interface ViewContext { today: LocalDate; /** The date of the day page the block is on; null elsewhere. */ pageDate: LocalDate | null; /** 1: weeks start on Monday. Sunday otherwise (R3-20). */ weekStart?: WeekStart }

export function addDays(day: LocalDate, days: number): LocalDate {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** The day a date reference means here; null when it can't (`pageDate` off a day page, a bad day). */
export function resolveDateRef(ref: unknown, context: ViewContext): LocalDate | null {
  if (!ref || typeof ref !== "object") return null;
  if ("date" in ref) return typeof ref.date === "string" && validDay(ref.date) ? ref.date : null;
  if (!("relative" in ref)) return null;
  const base = ref.relative === "today" ? context.today : ref.relative === "pageDate" ? context.pageDate : null;
  const offset = "offset" in ref && Number.isInteger(ref.offset) ? (ref.offset as number) : 0;
  return base ? addDays(base, offset) : null;
}
/** The day a week starts, for the date it's in: Sunday, unless he's chosen Monday (R3-20). */
export function startOfWeek(day: LocalDate, weekStart: WeekStart = 0): LocalDate {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() - weekStart + 7) % 7));
}
/** The days `within` covers, both ends included. */
function withinRange(within: unknown, today: LocalDate, weekStart: WeekStart = 0): [LocalDate, LocalDate] | null {
  if (within === "past7") return [addDays(today, -6), today];
  if (within === "next7") return [today, addDays(today, 6)];
  if (within === "thisWeek") { const first = startOfWeek(today, weekStart); return [first, addDays(first, 6)]; }
  return null;
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : typeof value === "string" ? [value] : [];
const fold = (s: string): string => s.toLocaleLowerCase();

/**
 * Whether one condition holds for a value of this property. A condition the property's type doesn't offer (after a type
 * change) or one missing its value holds, so a broken rule never hides rows; null says "ignored".
 */
export function conditionHolds(property: Property, condition: Condition, value: CellValue, context: ViewContext): boolean | null {
  const { op } = condition, want = condition.value;
  if (op === "isEmpty") return isEmptyValue(value);
  if (op === "isNotEmpty") return !isEmptyValue(value);
  switch (property.type) {
    // Read as the type it works out to (relations.ts), so a condition never meets it here.
    case "rollup":
    case "formula":
      return null;
    case "files": {
      if (typeof want !== "string") return null;
      const has = Array.isArray(value) && (value as FileValue[]).some((f) => fold(f.name).includes(fold(want)));
      return op === "contains" ? has : op === "doesNotContain" ? !has : null;
    }
    case "text":
    case "url":
    case "email":
    case "phone": {
      if (typeof want !== "string") return null;
      const have = typeof value === "string" ? fold(value) : "";
      if (op === "contains") return have.includes(fold(want));
      if (op === "doesNotContain") return !have.includes(fold(want));
      if (op === "is") return have === fold(want);
      if (op === "isNot") return have !== fold(want);
      return null;
    }
    case "number":
    case "id": {
      if (typeof want !== "number" || !Number.isFinite(want)) return null;
      if (typeof value !== "number") return op === "ne";
      const cmp = { eq: value === want, ne: value !== want, gt: value > want, lt: value < want, gte: value >= want, lte: value <= want } as Record<string, boolean>;
      return op in cmp ? cmp[op]! : null;
    }
    case "select":
    case "status":
    case "relation":
    case "multiSelect": {
      const ids = strings(want);
      if (!ids.length) return null;
      const have = strings(value);
      const any = have.some((id) => ids.includes(id));
      if (op === "isAnyOf" || op === "contains" || op === "is") return any;
      if (op === "isNoneOf" || op === "doesNotContain" || op === "isNot") return !any;
      return null;
    }
    case "checkbox":
      return op === "is" && typeof want === "boolean" ? value === want : null;
    case "date":
    case "createdTime":
    case "editedTime": {
      const start = value && typeof value === "object" && !Array.isArray(value) ? value.start.slice(0, 10) : null;
      const end = value && typeof value === "object" && !Array.isArray(value) ? (value.end ?? value.start).slice(0, 10) : null;
      if (op === "within") {
        const range = withinRange(want, context.today, context.weekStart);
        if (!range) return null;
        return start !== null && start <= range[1] && end! >= range[0];
      }
      const day = resolveDateRef(want, context);
      if (!day) return null;
      if (start === null) return false;
      // A range is on a day when it covers it; before and after compare its ends.
      if (op === "is") return start <= day && end! >= day;
      if (op === "before") return start < day;
      if (op === "after") return end! > day;
      if (op === "onOrBefore") return start <= day;
      if (op === "onOrAfter") return end! >= day;
      return null;
    }
  }
}
/** The rule that colours this row, or none. A rule whose property is gone matches nothing, and stays in the list as broken. */
export function rowColour(db: Database, view: View, row: Page, context: ViewContext): ColourRule | null {
  for (const rule of view.colourRules ?? []) {
    const property = propertyOf(db, rule.rule.by);
    if (property && conditionHolds(property, rule.rule, cellValue(db, row, rule.rule.by), context)) return rule;
  }
  return null;
}
export function rowMatches(db: Database, row: Page, filter: readonly Condition[], context: ViewContext, any = false): boolean {
  // A filter on a deleted property is shown struck through and ignored (design §13), as is one that can't be read.
  const results = filter.map((c) => { const property = propertyOf(db, c.by); return property ? conditionHolds(property, c, cellValue(db, row, c.by), context) : null; }).filter((r) => r !== null);
  // With nothing left to read, no rule hides a row, under either.
  return any && results.length ? results.includes(true) : !results.includes(false);
}
/** Whether a row shows in this view, by its rules and how they combine. */
export const inView = (db: Database, row: Page, view: Pick<View, "filter" | "filterAny">, context: ViewContext): boolean => rowMatches(db, row, view.filter, context, view.filterAny);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Sort keys compare within one type: text by collation, numbers and dates by value, options by their order. Empty is never compared. */
function compareValues(property: Property, a: CellValue, b: CellValue): number {
  const order = (id: unknown) => (property.options ?? []).findIndex((o) => o.id === id);
  switch (property.type) {
    case "rollup":
    case "formula":
      return 0;
    case "files":
      return collator.compare((a as FileValue[])[0]?.name ?? "", (b as FileValue[])[0]?.name ?? "");
    case "text":
    case "url":
    case "email":
    case "phone":
      return collator.compare(String(a), String(b));
    case "number":
    case "id":
      return (a as number) - (b as number);
    case "select":
    case "status":
      return order(a) - order(b);
    case "relation":
    case "multiSelect": {
      const x = (a as string[]).map(order).sort((p, q) => p - q), y = (b as string[]).map(order).sort((p, q) => p - q);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return x.length - y.length;
    }
    case "date":
    case "createdTime":
    case "editedTime":
      // ISO days and wall times compare exactly as strings.
      return (a as DateValue).start < (b as DateValue).start ? -1 : (a as DateValue).start > (b as DateValue).start ? 1 : 0;
    case "checkbox":
      return Number(a) - Number(b);
  }
}
/** The rows a view shows: live rows, filtered (all conditions), then sorted by each key in turn; empty last; ties keep page order. */
/** Layouts with no room for a tree: unless it's flat, a parent carries its sub-items on its card (sub-items design §2). A Timeline lists them flat for now: nesting its bars isn't built yet. */
export const showsSubItemsOnCards = (db: Database, view: Pick<View, "layout" | "subItemsDisplay">): boolean =>
  Boolean(db.subItems) && view.layout !== "table" && view.layout !== "list" && view.layout !== "timeline" && view.subItemsDisplay !== "flat";
/** Parents only, or sub-items only. A row whose parent has gone reads as a parent. */
function inSubItemsShow(db: Database, row: Page, view: View): boolean {
  if (!db.subItems) return true;
  const show = showsSubItemsOnCards(db, view) ? "parents" : view.subItemsShow;
  if (!show || show === "both") return true;
  const raw = row.values?.[db.subItems.parent];
  return (Array.isArray(raw) && raw.length > 0) === (show === "subs");
}
export function viewRows(ws: Workspace, databaseId: string, view: View, context: ViewContext): Page[] {
  const page = ws.pages.find((p) => p.id === databaseId);
  if (!isDatabase(page)) return [];
  const db = page.database;
  const rows = databaseRows(ws, databaseId).filter((r) => inView(db, r, view, context) && inSubItemsShow(db, r, view));
  // A sort on a deleted property is dropped quietly (design §13).
  const sorts = view.sort.map((s) => ({ ...s, property: propertyOf(db, s.by) })).filter((s): s is Sort & { property: Property } => s.property !== null);
  if (!sorts.length) return rows;
  const keyed = rows.map((row, index) => ({ row, index, values: sorts.map((s) => cellValue(db, row, s.by)) }));
  keyed.sort((x, y) => {
    for (let i = 0; i < sorts.length; i++) {
      const s = sorts[i]!, a = x.values[i]!, b = y.values[i]!;
      const ea = s.property.type !== "checkbox" && isEmptyValue(a), eb = s.property.type !== "checkbox" && isEmptyValue(b);
      if (ea || eb) { if (ea !== eb) return ea ? 1 : -1; continue; }
      const c = compareValues(s.property, a, b);
      if (c) return s.direction === "desc" ? -c : c;
    }
    return x.index - y.index;
  });
  return keyed.map((k) => k.row);
}
/** The view's shown properties, in order, after the title: listed ones that still exist. */
/** What can run long enough to wrap: not a number, a tick or an ID. */
export const canWrap = (type: PropertyType): boolean => type !== "number" && type !== "checkbox" && type !== "id";
/**
 * A column dropped before another, or last with null (R4-18). Crossing the frozen edge changes only which columns are frozen (R4-13):
 * dropped among the frozen it joins them, dropped past the edge it leaves them, and dropped right on the edge it stays as it was.
 */
export function columnMoved(columns: View["columns"], frozenThrough: string | undefined, id: string, beforeId: string | null): { columns: View["columns"]; frozenThrough?: string | null } | null {
  const from = columns.findIndex((c) => c.id === id), moved = columns[from];
  if (!moved || beforeId === id) return null;
  const through = frozenThrough ? columns.findIndex((c) => c.id === frozenThrough) : -1;
  const rest = columns.filter((c) => c.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((c) => c.id === beforeId);
  if (at < 0 || at === from) return null;
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  if (through < 0) return { columns: next };
  const stay = rest.filter((c) => columns.indexOf(c) <= through).length;
  const count = stay + ((at < stay || (at === stay && from <= through)) ? 1 : 0);
  const last = count ? next[count - 1]!.id : null;
  return last === frozenThrough ? { columns: next } : { columns: next, frozenThrough: last };
}

export function viewColumns(db: Database, view: View): { property: Property; width?: number; wrap?: true }[] {
  return view.columns.flatMap((c) => { const property = db.properties.find((p) => p.id === c.id); return property ? [{ property, ...(c.width !== undefined ? { width: c.width } : {}), ...(c.wrap ? { wrap: true as const } : {}) }] : []; });
}

/**
 * A new row in a filtered view (design §7.4): the values that keep it in sight where one value fits a condition, and
 * whether the row will be shown at all ("Added · hidden by this view's filter · Show" when not).
 */
export function newRowValues(db: Database, view: View, context: ViewContext, groupKey?: string): { title: string; values: RawValues; visible: boolean } {
  let title = "";
  const values: RawValues = {};
  const probeOf = (t: string, v: RawValues) => newRowProbe(db, t, v);
  // Under "any", one rule's value is enough, and only if it makes the row show; if it already shows, it needs none.
  const any = Boolean(view.filterAny);
  if (!any || !rowMatches(db, probeOf("", {}), view.filter, context, true)) for (const c of view.filter) {
    const property = propertyOf(db, c.by);
    if (!property || isReadOnly(property)) continue;
    const want = c.value;
    let value: Json | undefined;
    if (isTextType(property.type)) { if (c.op === "is" && typeof want === "string") value = want; }
    else if (property.type === "number") { if (c.op === "eq" && typeof want === "number") value = want; }
    else if (property.type === "select" || property.type === "status") { const ids = strings(want); if (["isAnyOf", "is"].includes(c.op) && ids.length === 1) value = ids[0]; }
    else if (property.type === "multiSelect" || property.type === "relation") { const ids = strings(want); if (["isAnyOf", "contains"].includes(c.op) && ids.length === 1) value = [ids[0]]; }
    else if (property.type === "checkbox") { if (c.op === "is" && want === true) value = true; }
    else if (property.type === "date") { const day = c.op === "is" ? resolveDateRef(want, context) : null; if (day) value = { start: day }; }
    if (value === undefined) continue;
    try { value = storedValue(property, value); } catch { continue; }
    if (value === undefined) continue;
    if (any && !rowMatches(db, property.id === titleId ? probeOf(value as string, {}) : probeOf("", { [property.id]: value }), view.filter, context, true)) continue;
    if (property.id === titleId) title = value as string; else values[property.id] = value;
    if (any) break;
  }
  // A row added under a group starts with that group's value, even where the filter wants another (then it's hidden, and the notice says so).
  const section = groupKey === undefined ? undefined : splitSection(groupKey);
  const grouped = section ? viewGroupBy(db, view) : null;
  // A group by created time can't start a row off with a value: it lands in the group its own time says.
  if (grouped && !isReadOnly(grouped)) {
    const value = section!.group === noGroupKey ? undefined : storedValue(grouped, groupValue(grouped, section!.group, undefined, undefined, context.today, view.groupDateBy, context.weekStart));
    if (value === undefined) delete values[grouped.id]; else values[grouped.id] = value;
  }
  const subGrouped = section?.sub !== undefined ? viewSubGroupBy(db, view) : null;
  if (subGrouped && !isReadOnly(subGrouped)) {
    const value = section!.sub === noGroupKey ? undefined : storedValue(subGrouped, groupValue(subGrouped, section!.sub!, undefined, undefined, context.today, view.subGroupDateBy, context.weekStart));
    if (value === undefined) delete values[subGrouped.id]; else values[subGrouped.id] = value;
  }
  return { title, values, visible: inView(db, newRowProbe(db, title, values), view, context) };
}

// ---------------------------------------------------------------- views: groups (design §7.2, §7.3)

/** The group of rows with no value. */
export const noGroupKey = "none";
const canGroup = (type: PropertyType): boolean => type !== "text" && type !== "id" && type !== "rollup" && type !== "formula";
const canMakeColumns = (type: PropertyType): boolean => type === "select" || type === "status" || type === "checkbox" || type === "relation";
/** A rollup groups by what it works out to, whatever that is, though a card can't be dragged there, so it makes no board. */
const groupsBy = (p: Property, layout: ViewLayout): boolean => (layout === "board" ? !p.rollup && p.formula === undefined && canMakeColumns(p.type) : Boolean(p.rollup) || p.formula !== undefined || canGroup(p.type));
/** What a view of this layout can group by: a board's columns need a value a card can be dragged to (design §7.2). */
export function groupableProperties(db: Database, layout: ViewLayout): Property[] {
  if (layout === "calendar") return [];
  return db.properties.filter((p) => groupsBy(p, layout));
}
/** The property a view groups by now; null when it was deleted or its type can't group any more. */
/** A section of a view with two layers has both keys in one: `+ New` under it, a drag to it and its fold all read this. */
const sectionSeparator = "\u0001";
export const sectionKey = (group: string, sub: string): string => `${group}${sectionSeparator}${sub}`;
export function splitSection(key: string): { group: string; sub?: string } {
  const [group, sub] = key.split(sectionSeparator) as [string, string | undefined];
  return sub === undefined ? { group } : { group, sub };
}
export function viewSubGroupBy(db: Database, view: View): Property | null {
  if (!viewGroupBy(db, view) || view.subGroupBy === view.groupBy) return null;
  const property = view.subGroupBy ? db.properties.find((p) => p.id === view.subGroupBy) : undefined;
  return property && groupsBy(property, "table") ? property : null;
}
/** These rows in the second layer, as `viewGroups` does the first; null without one. */
export function viewSubGroups(db: Database, view: View, rows: readonly Page[], rawFor: (row: Page, columnId: string) => unknown = rawOf, weekStart: WeekStart = 0): ViewGroups | null {
  if (!viewSubGroupBy(db, view)) return null;
  const { subGroupDateBy, hiddenSubGroups, ...rest } = view;
  return viewGroups(db, { ...rest, layout: "table", groupBy: view.subGroupBy!, ...(subGroupDateBy ? { groupDateBy: subGroupDateBy } : { groupDateBy: "month" as const }), hiddenGroups: hiddenSubGroups ?? [] }, rows, rawFor, weekStart);
}
/** The sections rows are drawn in and dragged between: the groups, or each group's sub-groups under one key. */
export function viewSections(db: Database, view: View, rows: readonly Page[], rawFor: (row: Page, columnId: string) => unknown = rawOf, weekStart: WeekStart = 0): ViewGroups | null {
  const groups = viewGroups(db, view, rows, rawFor, weekStart);
  if (!groups || !viewSubGroupBy(db, view)) return groups;
  // A group with no rows keeps one section of its own, or a second layer with no options would leave it nowhere to add or drop.
  return { ...groups, shown: groups.shown.flatMap((g) => !g.rows.length ? [g] : viewSubGroups(db, view, g.rows, rawFor, weekStart)!.shown.map((s) => ({ key: sectionKey(g.key, s.key), name: `${g.name} · ${s.name}`, rows: s.rows }))) };
}
/** One group or section by its key. A board draws every group in every lane, so a cell with no rows is a place too, though `viewSections` doesn't list it. */
export function viewSection(db: Database, view: View, rows: readonly Page[], key: string, rawFor: (row: Page, columnId: string) => unknown = rawOf, weekStart: WeekStart = 0): ViewGroup | null {
  const { group, sub } = splitSection(key);
  const first = viewGroups(db, view, rows, rawFor, weekStart)?.shown.find((g) => g.key === group);
  if (!first || sub === undefined) return first ?? null;
  const second = viewSubGroups(db, view, rows, rawFor, weekStart)?.shown.find((s) => s.key === sub);
  return second ? { key, name: `${first.name} · ${second.name}`, rows: first.rows.filter((r) => second.rows.includes(r)) } : null;
}
export function viewGroupBy(db: Database, view: View): Property | null {
  // A calendar doesn't group; its `groupBy` is kept unread, for switching back.
  if (view.layout === "calendar") return null;
  const property = view.groupBy ? db.properties.find((p) => p.id === view.groupBy) : undefined;
  return property && groupsBy(property, view.layout) ? property : null;
}
const statusOrder: StatusGroup[] = ["todo", "active", "done"];
/** Options in the order groups show them: a status's by To do, In progress, Done, as its editor lists them. */
export function groupOptions(property: Property): Option[] {
  const options = property.options ?? [];
  return property.type === "status" ? statusOrder.flatMap((g) => options.filter((o) => (o.group ?? "todo") === g)) : options;
}
function dateGroupKey(start: string, by: GroupDateBy, weekStart: WeekStart): string {
  const day = start.slice(0, 10);
  return by === "day" ? day : by === "week" ? startOfWeek(day, weekStart) : day.slice(0, 7);
}
const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
function dateGroupName(key: string, by: GroupDateBy): string {
  if (by === "month") return monthLabel.format(new Date(`${key}-01T12:00:00Z`));
  const label = dayLabel.format(new Date(`${key}T12:00:00Z`));
  return by === "week" ? `Week of ${label}` : label;
}
/** A row as it would be if added now, app-filled values included, to ask whether a view's filter would show it. */
export function newRowProbe(db: Database, title: string, values: Page["values"]): Page {
  const now = new Date().toISOString();
  return { id: "", type: "document", date: null, title, document: "[]", values: { ...values, ...(db.nextRowNumber === undefined ? {} : { [rowNumberKey]: db.nextRowNumber }) }, createdAt: now, editedAt: now } as Page;
}
/** The keys of the groups a value belongs to: several for a multi-select, the no-value group when empty. */
function groupKeys(property: Property, value: CellValue, by: GroupDateBy, weekStart: WeekStart): string[] {
  if (property.type === "checkbox") return [value === true ? "checked" : "unchecked"];
  if (isEmptyValue(value)) return [noGroupKey];
  if (property.type === "multiSelect" || property.type === "relation") return value as string[];
  if (property.type === "date" || isTimeType(property.type)) return [dateGroupKey((value as DateValue).start, by, weekStart)];
  return [String(value)];
}
export interface ViewGroup { key: string; name: string; rows: Page[] }
export interface ViewGroups {
  property: Property;
  shown: ViewGroup[];
  /** Hidden by him, listed at the end with their counts. */
  hidden: ViewGroup[];
}
/**
 * A view's rows in its groups, each keeping the order they came in. Options always have a group, so a board keeps a
 * column to drag to; other values only where a row has them. No value comes last. `rawFor` reads a row's value, so a
 * change on its way shows in its new group at once.
 */
export function viewGroups(db: Database, view: View, rows: readonly Page[], rawFor: (row: Page, columnId: string) => unknown = rawOf, weekStart: WeekStart = 0): ViewGroups | null {
  const property = viewGroupBy(db, view);
  if (!property) return null;
  const by = view.groupDateBy ?? "month";
  const found = new Map<string, Page[]>();
  for (const row of rows) for (const key of groupKeys(property, isReadOnlyType(property.type) ? cellValue(db, row, property.id) : readValue(property, rawFor(row, property.id)), by, weekStart)) {
    const list = found.get(key);
    if (list) list.push(row); else found.set(key, [row]);
  }
  const group = (key: string, name: string): ViewGroup => ({ key, name, rows: found.get(key) ?? [] });
  const groups: ViewGroup[] = [];
  if (property.type === "checkbox") groups.push(group("unchecked", "Unchecked"), group("checked", "Checked"));
  else if (property.type === "relation") {
    // Its options are every row of its target: a group only for those linked here, in the target's order.
    groups.push(...groupOptions(property).filter((o) => found.has(o.id)).map((o) => group(o.id, o.name)), group(noGroupKey, "No value"));
  } else if (hasOptions(property.type)) {
    groups.push(...groupOptions(property).map((o) => group(o.id, o.name)));
    // A status always has a value (design §6.1), so it has no group for none.
    if (property.type !== "status") groups.push(group(noGroupKey, "No value"));
  } else {
    const keys = [...found.keys()].filter((k) => k !== noGroupKey);
    if (property.type === "number") keys.sort((a, b) => Number(a) - Number(b)); else keys.sort(collator.compare);
    groups.push(...keys.map((k) => group(k, property.type === "date" || isTimeType(property.type) ? dateGroupName(k, by) : k)));
    if (found.has(noGroupKey)) groups.push(group(noGroupKey, "No value"));
  }
  const hidden = new Set(view.hiddenGroups ?? []);
  const keep = (g: ViewGroup) => !view.hideEmptyGroups || g.rows.length > 0;
  return { property, shown: groups.filter((g) => !hidden.has(g.key) && keep(g)), hidden: groups.filter((g) => hidden.has(g.key) && keep(g)) };
}
/** What a calendar can sit its rows by. */
export const dateProperties = (db: Database): Property[] => db.properties.filter((p) => p.type === "date" || isTimeType(p.type));
/** The date property a calendar sits by now; null when it was deleted or isn't a date any more. */
export function viewDateBy(db: Database, view: View): Property | null {
  const property = view.dateBy ? db.properties.find((p) => p.id === view.dateBy) : undefined;
  return property && (property.type === "date" || isTimeType(property.type)) ? property : null;
}
export interface CalendarRows {
  /** Rows by the days they cover, for the days in `from`–`to`; a range is on each of its days. */
  days: Map<LocalDate, Page[]>;
  /** Rows with no date, always in reach (design §7.2), a row from before Created time was kept too. */
  undated: Page[];
}
export function calendarRows(property: Property | null, rows: readonly Page[], from: LocalDate, to: LocalDate, rawFor: (row: Page, columnId: string) => unknown = rawOf): CalendarRows {
  const days = new Map<LocalDate, Page[]>(), undated: Page[] = [];
  for (const row of rows) {
    const value = !property ? null : isTimeType(property.type) ? rowTime(property, row) : (readValue(property, rawFor(row, property.id)) as DateValue | null);
    if (!value) { undated.push(row); continue; }
    const start = value.start.slice(0, 10), end = (value.end ?? value.start).slice(0, 10);
    if (end < from || start > to) continue;
    for (let day = start < from ? from : start; day <= end && day <= to; day = addDays(day, 1)) {
      const list = days.get(day);
      if (list) list.push(row); else days.set(day, [row]);
    }
  }
  return { days, undated };
}
/** A row's date moved by the days between where he took it from and where he dropped it: its length and time stay. An undated one gets that day. */
export function movedDate(property: Property, raw: unknown, from: LocalDate | null, to: LocalDate): DateValue {
  const had = readValue(property, raw) as DateValue | null;
  if (!had || !from) return { start: to };
  const shift = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  const moved = (text: string) => `${addDays(text.slice(0, 10), shift)}${text.slice(10)}`;
  return { start: moved(had.start), ...(had.end ? { end: moved(had.end) } : {}) };
}

/**
 * What a row stores once it's in this group, given what it holds now. A multi-select swaps the group it left for this
 * one and keeps its others. A date keeps its time and its length, moved to a day in the group: `today` if it's in that
 * group, else the group's first day.
 */
export function groupValue(property: Property, key: string, raw: unknown, fromKey: string | undefined, today: LocalDate, by: GroupDateBy = "month", weekStart: WeekStart = 0): Json | undefined {
  if (key === noGroupKey) return undefined;
  switch (property.type) {
    case "checkbox": return key === "checked" ? true : undefined;
    case "number": return Number(key);
    case "relation":
    case "multiSelect": {
      const had = readValue(property, raw);
      const kept = Array.isArray(had) ? (had as string[]).filter((id) => id !== fromKey && id !== key) : [];
      return [...kept, key];
    }
    case "date": {
      const day = dateGroupKey(today, by, weekStart) === key ? today : by === "month" ? `${key}-01` : key;
      const had = readValue(property, raw) as DateValue | null;
      if (!had) return { start: day };
      const shift = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${had.start.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
      const moved = (text: string) => `${addDays(text.slice(0, 10), shift)}${text.slice(10)}`;
      return { start: moved(had.start), ...(had.end ? { end: moved(had.end) } : {}) };
    }
    default: return key;
  }
}

// ---------------------------------------------------------------- commands' inputs

/** A property as `addProperty` sends it: options without ids get them; a Status with none gets the three groups. */
export interface PropertyInput { id: string; name: string; type: PropertyType; options?: Option[]; format?: NumberFormat; withTime?: boolean; prefix?: string; target?: string; limit?: 1 | null; rollup?: Rollup; formula?: string }
/** One schema or view change: one write, the database page. */
export type DatabaseChange =
  | { kind: "addProperty"; property: PropertyInput; /** the view it was added from: it shows there; other views list it too */ viewId?: string; /** in that view, placed before this column (R4-18's Insert); last otherwise */ beforeId?: string }
  | { kind: "updateProperty"; propertyId: string; name?: string; type?: PropertyType; options?: Option[]; format?: NumberFormat; withTime?: boolean; prefix?: string; target?: string; limit?: 1 | null; rollup?: Rollup; formula?: string }
  /** "Show on Books": a relation's other side, made as a property of the target, or gone with null. */
  | { kind: "setDependencies"; on: { blockedBy: string; blocking: string; date: string; end?: string; mode: DependencyMode; avoidWeekends?: boolean; using?: boolean } | null }
  | { kind: "setSubItems"; on: { parent: string; sub: string; using?: boolean } | null }
  | { kind: "setMirror"; propertyId: string; mirror: { id: string; name: string } | null }
  | { kind: "removeProperty"; propertyId: string }
  | { kind: "duplicateProperty"; propertyId: string; newId: string }
  | { kind: "moveProperty"; propertyId: string; beforeId: string | null }
  | { kind: "addView"; view: View }
  | { kind: "updateView"; viewId: string; cardImage?: string | null; subItemsDisplay?: SubItemsDisplay; subItemsShow?: SubItemsShow; name?: string; columns?: View["columns"]; sort?: Sort[]; filter?: Condition[]; layout?: ViewLayout; /** null: no groups */ groupBy?: string | null; groupDateBy?: GroupDateBy; hideEmptyGroups?: boolean; hiddenGroups?: string[]; /** null: none */ subGroupBy?: string | null; subGroupDateBy?: GroupDateBy; hiddenSubGroups?: string[]; dateBy?: string; /** null: back to a month */ calendarSpan?: "week" | null; timelineEnd?: string | null; timelineUnit?: View["timelineUnit"]; timelineTable?: true | null; openIn?: "center" | "side" | null; colourRules?: ColourRule[]; frozenThrough?: string | null; /** null: back to the default */ nameWidth?: number | null; filterAny?: boolean; wrapName?: boolean; calculations?: Record<string, CalcKind>; /** null: the count */ boardCalculation?: BoardCalculation | null; /** null: none of its own */ defaultTemplate?: string | null }
  /** null: none */
  | { kind: "setRepeat"; templateId: string; repeat: Omit<Repeat, "last" | "lastRan"> | null }
  | { kind: "setDefaultTemplate"; templateId: string | null }
  | { kind: "removeView"; viewId: string }
  | { kind: "moveView"; viewId: string; beforeId: string | null };
/** One row's edit: values by column id (`title` for the title), null clears; `expected`: those columns as the edit saw them. */
export interface RowEdit { pageId: string; values: Record<string, Json>; expected: Record<string, Json>; /** The database the sender thinks it's in: a tab that missed a move is refused rather than writing a property across (move-row §7). */ databaseId?: string }

// ---------------------------------------------------------------- schema and view changes

const filterOps = new Set<string>(filterOpList);
const statusGroups = new Set<StatusGroup>(["todo", "active", "done"]);
const numberFormats = new Set<NumberFormat>(["plain", "comma", "percent", "currency"]);
const everyCalc: CalcKind[] = ["countAll", "countValues", "countUnique", "countEmpty", "countNotEmpty", "percentEmpty", "percentNotEmpty"];
/** What a column of this type can add up to, in the menu's order. */
export function calcChoices(type: PropertyType): CalcKind[] {
  switch (type) {
    case "number": return [...everyCalc, "sum", "average", "median", "min", "max", "range"];
    case "date":
    case "createdTime":
    case "editedTime": return [...everyCalc, "earliest", "latest", "dateRange"];
    case "id": return [...everyCalc, "min", "max"];
    case "checkbox": return ["countAll", "checked", "unchecked", "percentChecked", "percentUnchecked"];
    case "status": return [...everyCalc, "countPerGroup", "percentPerGroup"];
    default: return everyCalc;
  }
}
export const calcLabels: Record<CalcKind, string> = { countAll: "Count all", countValues: "Count values", countUnique: "Count unique", countEmpty: "Count empty", countNotEmpty: "Count not empty", percentEmpty: "Percent empty", percentNotEmpty: "Percent not empty", sum: "Sum", average: "Average", median: "Median", min: "Min", max: "Max", range: "Range", earliest: "Earliest date", latest: "Latest date", dateRange: "Date range", checked: "Checked", unchecked: "Unchecked", percentChecked: "Percent checked", percentUnchecked: "Percent unchecked", countPerGroup: "Count per group", percentPerGroup: "Percent per group" };
/** The view's calculations that still fit their column: a deleted column or a changed type just draws nothing, and comes back if it's changed back. */
export function viewCalculations(db: Database, view: Pick<View, "calculations">): Record<string, CalcKind> {
  const out: Record<string, CalcKind> = {};
  for (const [id, kind] of Object.entries(view.calculations ?? {})) {
    const property = propertyOf(db, id);
    if (property && calcChoices(property.type).includes(kind)) out[id] = kind;
  }
  return out;
}
/** A board's calculation while it still fits its property; otherwise its heads go back to the count. */
export function viewBoardCalculation(db: Database, view: Pick<View, "boardCalculation">): BoardCalculation | null {
  const chosen = view.boardCalculation, property = chosen ? propertyOf(db, chosen.by) : null;
  return chosen && property && calcChoices(property.type).includes(chosen.kind) ? chosen : null;
}
export type CalcResult =
  | { type: "count"; value: number }
  | { type: "percent"; value: number | null }
  | { type: "number"; value: number | null }
  | { type: "date"; value: string | null }
  | { type: "days"; value: number | null }
  | { type: "groups"; percent: boolean; value: { group: StatusGroup; count: number }[] };
const clean = (n: number) => Math.round(n * 1e10) / 1e10;
/**
 * One column over these rows: the rows a view shows, or one group's, all of them whatever "Show more" has drawn.
 * `read` lets a cell still saving count as it shows. No rows, or none with a value, has no average or date: null, not 0.
 */
export function columnCalc(db: Database, rows: readonly Page[], columnId: string, kind: CalcKind, read: (row: Page, columnId: string) => CellValue = (row, id) => cellValue(db, row, id)): CalcResult {
  const values = rows.map((r) => read(r, columnId));
  const filled = values.filter((v) => !isEmptyValue(v));
  const percent = (n: number): CalcResult => ({ type: "percent", value: rows.length ? clean((n / rows.length) * 100) : null });
  const numbers = filled.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  const number = (make: () => number): CalcResult => ({ type: "number", value: numbers.length ? clean(make()) : null });
  const dates = filled.filter((v): v is DateValue => typeof v === "object" && !Array.isArray(v) && v !== null);
  const earliest = dates.map((d) => d.start).sort()[0] ?? null, latest = dates.map((d) => d.end ?? d.start).sort().at(-1) ?? null;
  const count = (value: number): CalcResult => ({ type: "count", value });
  switch (kind) {
    case "countAll": return count(rows.length);
    case "countValues": return count(filled.reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 1), 0));
    case "countUnique": return count(new Set(filled.flatMap((v) => (Array.isArray(v) ? (v as Array<string | FileValue>).map((x) => (typeof x === "string" ? x : x.id)) : [JSON.stringify(v)]))).size);
    case "countEmpty": return count(rows.length - filled.length);
    case "countNotEmpty": return count(filled.length);
    case "percentEmpty": return percent(rows.length - filled.length);
    case "percentNotEmpty": return percent(filled.length);
    case "sum": return { type: "number", value: clean(numbers.reduce((n, v) => n + v, 0)) };
    case "average": return number(() => numbers.reduce((n, v) => n + v, 0) / numbers.length);
    case "median": return number(() => { const mid = numbers.length >> 1; return numbers.length % 2 ? numbers[mid]! : (numbers[mid - 1]! + numbers[mid]!) / 2; });
    case "min": return number(() => numbers[0]!);
    case "max": return number(() => numbers.at(-1)!);
    case "range": return number(() => numbers.at(-1)! - numbers[0]!);
    case "earliest": return { type: "date", value: earliest };
    case "latest": return { type: "date", value: latest };
    case "dateRange": return { type: "days", value: earliest && latest ? Math.round((Date.parse(`${latest.slice(0, 10)}T12:00:00Z`) - Date.parse(`${earliest.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null };
    case "checked": return count(values.filter((v) => v === true).length);
    case "unchecked": return count(values.filter((v) => v !== true).length);
    case "percentChecked": return percent(values.filter((v) => v === true).length);
    case "percentUnchecked": return percent(values.filter((v) => v !== true).length);
    case "countPerGroup":
    case "percentPerGroup": {
      const options = propertyOf(db, columnId)?.options ?? [];
      const inGroup = (group: StatusGroup) => values.filter((v) => options.find((o) => o.id === v) && (options.find((o) => o.id === v)!.group ?? "todo") === group).length;
      const asPercent = kind === "percentPerGroup";
      return { type: "groups", percent: asPercent, value: statusOrder.map((group) => ({ group, count: asPercent ? (rows.length ? clean((inGroup(group) / rows.length) * 100) : 0) : inGroup(group) })) };
    }
  }
}
function cleanBoardCalculation(db: Database, input: BoardCalculation): BoardCalculation {
  if (!input || !propertyOf(db, input.by) || !(calcKinds as readonly unknown[]).includes(input.kind)) throw new DatabaseError("Can't calculate that");
  return { by: input.by, kind: input.kind };
}
function cleanCalculations(db: Database, input: unknown): Record<string, CalcKind> {
  if (!input || typeof input !== "object") throw new DatabaseError("Can't calculate that");
  const out: Record<string, CalcKind> = {};
  for (const [id, kind] of Object.entries(input)) {
    if (!(calcKinds as readonly unknown[]).includes(kind)) throw new DatabaseError("Can't calculate that");
    if (propertyOf(db, id)) out[id] = kind as CalcKind;
  }
  return out;
}

export const typeLabels: Record<PropertyType, string> = { text: "Text", number: "Number", select: "Select", multiSelect: "Multi-select", status: "Status", date: "Date", checkbox: "Checkbox", url: "URL", email: "Email", phone: "Phone", relation: "Relation", files: "Files", rollup: "Rollup", formula: "Formula", createdTime: "Created time", editedTime: "Edited time", id: "ID" };
const hasOptions = (type: PropertyType): boolean => type === "select" || type === "multiSelect" || type === "status";

function cleanName(value: unknown, what: string): string {
  const name = typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > limits.name) throw new DatabaseError(`${what} needs a name`);
  return name;
}
function checkId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200 || value === titleId) throw new DatabaseError("Invalid id");
  return value;
}
function cleanOptions(input: unknown, type: PropertyType): Option[] {
  if (!Array.isArray(input) || input.length > limits.options) throw new DatabaseError("Invalid options");
  const ids = new Set<string>(), names = new Set<string>();
  return input.map((o: Option) => {
    const id = checkId(o?.id), name = cleanName(o?.name, "An option");
    if (ids.has(id)) throw new DatabaseError("Invalid options");
    if (names.has(fold(name))) throw new DatabaseError(`There's already an option "${name}"`);
    ids.add(id); names.add(fold(name));
    const from = typeof o.from === "string" && o.from.length <= limits.name ? { from: o.from } : {};
    if (type !== "status") return o.group && statusGroups.has(o.group) ? { id, name, group: o.group, ...from } : { id, name, ...from };
    return { id, name, group: o.group && statusGroups.has(o.group) ? o.group : "todo", ...from };
  });
}
function uniqueName(db: Database, name: string, except?: string): void {
  if (fold(name) === fold(titleProperty.name) || db.properties.some((p) => p.id !== except && fold(p.name) === fold(name))) throw new DatabaseError(`There's already a property "${name}"`);
}
function cleanRollup(input: Rollup | undefined): Rollup {
  if (!input || typeof input.relation !== "string" || typeof input.property !== "string" || !(rollupFunctions as readonly string[]).includes(input.fn)) throw new DatabaseError("Invalid rollup");
  return { relation: input.relation, property: input.property, fn: input.fn };
}
/** A relation's target is a live database. A rollup reads a relation of this database, and a property of its target, never another rollup: no loop can form. */
function checkLinks(ws: Workspace, databaseId: string, db: Database, property: Property): void {
  if (property.type === "formula") {
    // No text that doesn't work replaces one that does (formula design §4).
    const problem = formulaProblem(property.formula ?? "", worldOf(ws), databaseId, property.id);
    if (problem) throw new DatabaseError(problem);
    return;
  }
  if (property.type === "relation" && property.target !== todosSourceId && !isDatabase(ws.pages.find((p) => p.id === property.target))) throw new DatabaseError("That database isn't there");
  if (property.type !== "rollup") return;
  const { relation, property: read } = property.rollup!;
  const through = db.properties.find((p) => p.id === relation);
  if (!through || through.type !== "relation") throw new DatabaseError("A rollup reads a relation");
  // To-dos' fixed columns, read through its own rows (relations.ts).
  if (through.target === todosSourceId) return;
  const target = ws.pages.find((p) => p.id === through.target);
  if (!isDatabase(target)) throw new DatabaseError("That database isn't there");
  if (read === titleId) return;
  const source = target.database.properties.find((p) => p.id === read);
  if (!source) throw new DatabaseError("Property not found");
  if (source.type === "rollup") throw new DatabaseError("A rollup can't read another rollup");
  if (source.type === "formula") { const problem = rollupProblem(worldOf(ws), databaseId, property); if (problem) throw new DatabaseError(problem); }
}
/**
 * A link's other end: this side's link written on that side, and a limit of 1 keeping to it. A two-way relation writes its
 * mirror. A relation of a database to itself, with no mirror, is its own other side: adding B to A also shows A on B, as in Notion.
 */
export function syncMirror(ws: Workspace, property: Property, rowId: string, before: readonly string[], after: readonly string[], at?: string): void {
  const target = ws.pages.find((p) => p.id === property.target);
  if (!isDatabase(target)) return;
  const own = !property.mirror && ws.pages.find((p) => p.id === rowId)?.parentId === target.id;
  const mirror = own ? property : target.database.properties.find((p) => p.id === property.mirror);
  if (!mirror) return;
  const linksOf = (row: Page, id: string): string[] => { const raw = row.values?.[id]; return Array.isArray(raw) ? (raw as string[]) : []; };
  const write = (row: Page, id: string, list: readonly string[]) => {
    const values: RawValues = { ...(row.values ?? {}) };
    if (list.length) values[id] = [...list]; else delete values[id];
    if (Object.keys(values).length) row.values = values; else delete row.values;
    // Its value changed, so it counts as edited.
    if (at) row.editedAt = at;
  };
  const rowOf = (id: string) => ws.pages.find((p) => p.id === id && p.parentId === target!.id);
  for (const id of before) {
    if (after.includes(id) || id === rowId) continue;
    const other = rowOf(id);
    if (other) write(other, mirror.id, linksOf(other, mirror.id).filter((x) => x !== rowId));
  }
  for (const id of after) {
    if (before.includes(id) || id === rowId) continue;
    const other = rowOf(id);
    if (!other) continue;
    const held = linksOf(other, mirror.id);
    if (held.includes(rowId)) continue;
    // Its other side holds one row: the one it held lets go of it.
    if (mirror.limit === 1) for (const was of held) { const old = ws.pages.find((p) => p.id === was); if (old) write(old, property.id, linksOf(old, property.id).filter((x) => x !== id)); }
    write(other, mirror.id, mirror.limit === 1 ? [rowId] : [...held, rowId]);
  }
}
function cleanProperty(input: PropertyInput, db: Database, except?: string): Property {
  if (!input || !(propertyTypes as readonly string[]).includes(input.type)) throw new DatabaseError("Unknown property type");
  const property: Property = { id: checkId(input.id), name: cleanName(input.name, "A property"), type: input.type };
  uniqueName(db, property.name, except);
  if (input.options !== undefined) property.options = cleanOptions(input.options, input.type);
  if (input.type === "status" && !property.options?.length) property.options = defaultStatusOptions();
  if (input.format !== undefined) { if (!numberFormats.has(input.format)) throw new DatabaseError("Unknown number format"); property.format = input.format; }
  if (input.withTime !== undefined) { if (typeof input.withTime !== "boolean") throw new DatabaseError("Invalid property"); if (input.withTime) property.withTime = true; }
  if (input.type === "relation") {
    if (typeof input.target !== "string") throw new DatabaseError("A relation needs a database");
    property.target = input.target;
    if (input.limit === 1) property.limit = 1;
  }
  if (input.type === "rollup") property.rollup = cleanRollup(input.rollup);
  if (input.type === "formula") {
    if (input.formula !== undefined && (typeof input.formula !== "string" || input.formula.length > limits.formula)) throw new DatabaseError("That formula is too long");
    property.formula = input.formula ?? "";
  }
  if (input.prefix !== undefined) {
    const prefix = typeof input.prefix === "string" ? input.prefix.trim() : null;
    if (prefix === null || prefix.length > limits.prefix) throw new DatabaseError("Too long for a prefix");
    if (prefix) property.prefix = prefix;
  }
  return property;
}
const knownColumn = (db: Database, id: unknown): boolean => typeof id === "string" && (id === titleId || db.properties.some((p) => p.id === id));
function cleanColumns(db: Database, input: unknown): View["columns"] {
  if (!Array.isArray(input) || input.length > limits.properties) throw new DatabaseError("Invalid view");
  const seen = new Set<string>();
  return input.map((c: { id: string; width?: number; wrap?: unknown }) => {
    if (!c || !knownColumn(db, c.id) || c.id === titleId || seen.has(c.id)) throw new DatabaseError("Invalid view");
    seen.add(c.id);
    const wrap = c.wrap === true ? { wrap: true as const } : {};
    if (c.width === undefined) return { id: c.id, ...wrap };
    if (!Number.isInteger(c.width) || c.width < 40 || c.width > 2000) throw new DatabaseError("Invalid view");
    return { id: c.id, width: c.width, ...wrap };
  });
}
/** Sorts and filters may still name a property deleted since (kept until he removes them); a new one must name a live one. */
function cleanSort(db: Database, input: unknown, before: Sort[]): Sort[] {
  if (!Array.isArray(input) || input.length > limits.sorts) throw new DatabaseError("Invalid sort");
  const had = new Set(before.map((s) => s.by));
  return input.map((s: Sort) => {
    if (!s || (!knownColumn(db, s.by) && !had.has(s.by)) || (s.direction !== "asc" && s.direction !== "desc")) throw new DatabaseError("Invalid sort");
    return { by: s.by, direction: s.direction };
  });
}
function cleanFilter(db: Database, input: unknown, before: Condition[]): Condition[] {
  if (!Array.isArray(input) || input.length > limits.conditions) throw new DatabaseError("Invalid filter");
  const had = new Set(before.map((c) => c.by));
  return input.map((c: Condition) => {
    if (!c || (!knownColumn(db, c.by) && !had.has(c.by)) || !filterOps.has(c.op)) throw new DatabaseError("Invalid filter");
    if (c.value === undefined) return { by: c.by, op: c.op };
    if (JSON.stringify(c.value).length > 2000) throw new DatabaseError("Invalid filter");
    return { by: c.by, op: c.op, value: structuredClone(c.value) as Json };
  });
}
function cleanLayout(input: unknown): ViewLayout {
  if (!(viewLayouts as readonly unknown[]).includes(input)) throw new DatabaseError("Unknown view type");
  return input as ViewLayout;
}
const dateBys = new Set<unknown>(["day", "week", "month"]);
const timelineUnitSet = new Set<unknown>(["hours", "day", "week", "month", "quarter", "year"]);
type GroupFields = Pick<View, "groupBy" | "groupDateBy" | "hideEmptyGroups" | "hiddenGroups" | "subGroupBy" | "subGroupDateBy" | "hiddenSubGroups" | "dateBy" | "openIn" | "calendarSpan" | "timelineEnd" | "timelineUnit" | "timelineTable" | "colourRules" | "frozenThrough" | "nameWidth">;
/** A view's group fields, checked. A new `groupBy` must name a live property that can group; one it already holds may be deleted since, and is kept unread, so Undo or changing the type back reads it again. */
function cleanGroup(db: Database, input: GroupFields, layout: ViewLayout, before?: Pick<View, "groupBy" | "subGroupBy" | "dateBy" | "timelineEnd">): GroupFields {
  const out: GroupFields = {};
  if (input.groupBy !== undefined) {
    if (input.groupBy !== before?.groupBy && !groupableProperties(db, layout).some((p) => p.id === input.groupBy)) throw new DatabaseError("Can't group by that");
    out.groupBy = input.groupBy;
  }
  // Like `groupBy`: a new one must be a live date; the one it holds may be deleted since. A Formula or Rollup is stored without the type it works out to, which
  // the menu reads, so it's taken here: if it stops being a date, the view reads as one whose date is gone (`viewDateBy`), and asks for another.
  const workedOut = (p: Property) => p.formula !== undefined || Boolean(p.rollup);
  if (input.dateBy !== undefined) {
    if (input.dateBy !== before?.dateBy && !db.properties.some((p) => p.id === input.dateBy && (p.type === "date" || isTimeType(p.type) || workedOut(p)))) throw new DatabaseError("Can't place rows by that");
    out.dateBy = input.dateBy;
  }
  if (input.calendarSpan === "week") out.calendarSpan = "week";
  if (input.timelineEnd !== undefined) {
    if (input.timelineEnd !== before?.timelineEnd && !db.properties.some((p) => p.id === input.timelineEnd && (p.type === "date" || workedOut(p)))) throw new DatabaseError("Can't place rows by that");
    out.timelineEnd = input.timelineEnd;
  }
  if (input.timelineTable === true) out.timelineTable = true;
  if (input.timelineUnit !== undefined) { if (!timelineUnitSet.has(input.timelineUnit)) throw new DatabaseError("Invalid view"); out.timelineUnit = input.timelineUnit; }
  if (input.openIn === "center" || input.openIn === "side") out.openIn = input.openIn;
  if (input.colourRules?.length) out.colourRules = input.colourRules;
  if (input.frozenThrough) out.frozenThrough = input.frozenThrough;
  if (input.nameWidth !== undefined) {
    if (!Number.isInteger(input.nameWidth) || input.nameWidth < 40 || input.nameWidth > 2000) throw new DatabaseError("Invalid view");
    out.nameWidth = input.nameWidth;
  }
  if (input.groupDateBy !== undefined) { if (!dateBys.has(input.groupDateBy)) throw new DatabaseError("Invalid view"); out.groupDateBy = input.groupDateBy; }
  if (input.hideEmptyGroups) out.hideEmptyGroups = true;
  if (input.subGroupBy !== undefined) {
    const property = db.properties.find((p) => p.id === input.subGroupBy);
    if (input.subGroupBy !== before?.subGroupBy && !(property && groupsBy(property, "table"))) throw new DatabaseError("Can't group by that");
    out.subGroupBy = input.subGroupBy;
  }
  if (input.subGroupDateBy !== undefined) { if (!dateBys.has(input.subGroupDateBy)) throw new DatabaseError("Invalid view"); out.subGroupDateBy = input.subGroupDateBy; }
  if (input.hiddenSubGroups !== undefined) {
    if (!Array.isArray(input.hiddenSubGroups) || input.hiddenSubGroups.length > limits.hiddenGroups || input.hiddenSubGroups.some((k) => typeof k !== "string" || k.length > 200)) throw new DatabaseError("Invalid view");
    if (input.hiddenSubGroups.length) out.hiddenSubGroups = [...new Set(input.hiddenSubGroups)];
  }
  if (input.hiddenGroups !== undefined) {
    if (!Array.isArray(input.hiddenGroups) || input.hiddenGroups.length > limits.hiddenGroups || input.hiddenGroups.some((k) => typeof k !== "string" || k.length > 200)) throw new DatabaseError("Invalid view");
    if (input.hiddenGroups.length) out.hiddenGroups = [...new Set(input.hiddenGroups)];
  }
  return out;
}
function cleanView(db: Database, input: View): View {
  if (!input) throw new DatabaseError("Unknown view type");
  const layout = cleanLayout(input.layout);
  return { ...(input.subItemsDisplay === 'flat' ? { subItemsDisplay: 'flat' as const } : {}), ...(input.subItemsShow === 'parents' || input.subItemsShow === 'subs' ? { subItemsShow: input.subItemsShow } : {}), id: checkId(input.id), name: cleanName(input.name, "A view"), layout, columns: cleanColumns(db, input.columns), sort: cleanSort(db, input.sort, []), filter: cleanFilter(db, input.filter, []), ...(input.filterAny ? { filterAny: true as const } : {}), ...(input.wrapName ? { wrapName: true as const } : {}), ...(input.boardCalculation ? { boardCalculation: cleanBoardCalculation(db, input.boardCalculation) } : {}), ...(input.defaultTemplate ? { defaultTemplate: input.defaultTemplate } : {}), ...(input.calculations && Object.keys(input.calculations).length ? { calculations: cleanCalculations(db, input.calculations) } : {}), ...cleanGroup(db, input, layout, input) };
}
function move<T extends { id: string }>(list: T[], id: string, beforeId: string | null): T[] {
  const item = list.find((x) => x.id === id);
  if (!item || id === beforeId) throw new DatabaseError("Not found");
  const rest = list.filter((x) => x !== item);
  const at = beforeId === null ? rest.length : rest.findIndex((x) => x.id === beforeId);
  if (at < 0) throw new DatabaseError("Not found");
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Gives every row of a database with no number one, in page order, once it has an ID property. Trashed rows too: they can come back. */
function numberRows(ws: Workspace, page: Page & { database: Database }): void {
  let next = page.database.nextRowNumber ?? 1;
  for (const row of ws.pages) {
    if (row.parentId !== page.id || row.type !== "document" || typeof row.values?.[rowNumberKey] === "number") continue;
    row.values = { ...row.values, [rowNumberKey]: next++ };
  }
  page.database.nextRowNumber = next;
}
/** A new row's number, once numbers have started. */
export function numberNewRow(db: Database, row: Page): void {
  if (db.nextRowNumber !== undefined) row.values = { ...row.values, [rowNumberKey]: db.nextRowNumber++ };
}
/** After an Undo, a database's next number stays where it had got to, so a number is never used twice. */
export function keepRowNumbers(before: Workspace, after: Workspace): void {
  for (const page of after.pages) {
    if (!isDatabase(page)) continue;
    const had = before.pages.find((p) => p.id === page.id)?.database?.nextRowNumber;
    if (had !== undefined && had > (page.database.nextRowNumber ?? 0)) page.database.nextRowNumber = had;
  }
}

/** Applies one change to the database page in place; returns the receipt's message. */
function mirrorOf(ws: Workspace, property: Property): { db: Database; property: Property; title: string } | null {
  const target = ws.pages.find((p) => p.id === property.target);
  const other = isDatabase(target) ? target.database.properties.find((p) => p.id === property.mirror) : undefined;
  return other ? { db: target!.database!, property: other, title: target!.title.trim() || "Untitled" } : null;
}
export function changeDatabase(ws: Workspace, page: Page & { database: Database }, change: DatabaseChange): string {
  const db = page.database;
  const property = (id: string): Property => { const p = db.properties.find((x) => x.id === id); if (!p) throw new DatabaseError("Property not found"); return p; };
  const view = (id: string): View => { const v = db.views.find((x) => x.id === id); if (!v) throw new DatabaseError("View not found"); return v; };
  switch (change?.kind) {
    case "addProperty": {
      if (db.properties.length >= limits.properties) throw new DatabaseError("Too many properties");
      if (db.properties.some((p) => p.id === change.property?.id)) throw new DatabaseError("Invalid id");
      const added = cleanProperty(change.property, db);
      if (change.viewId !== undefined) view(change.viewId);
      db.properties.push(added);
      checkLinks(ws, page.id, db, added);
      if (added.type === "id") numberRows(ws, page);
      // A new property shows in every view, at the end (Notion shows it where it was made; one person rarely needs it hidden elsewhere).
      for (const v of db.views) v.columns.push({ id: added.id });
      if (change.viewId !== undefined && change.beforeId !== undefined) {
        const v = view(change.viewId), at = v.columns.findIndex((c) => c.id === change.beforeId);
        if (at >= 0) { v.columns.pop(); v.columns.splice(at, 0, { id: added.id }); }
      }
      return `Added ${added.name}`;
    }
    case "updateProperty": {
      const old = property(change.propertyId);
      const type = change.type ?? old.type;
      if (old.mirror && type !== "relation") throw new DatabaseError("Turn off its other side first");
      const next = cleanProperty({ id: old.id, name: change.name ?? old.name, type, options: change.options ?? (makesOptions(old, type) ? optionsFromText(ws, page.id, old, type) : old.options), format: change.format ?? old.format, withTime: change.withTime ?? old.withTime, prefix: change.prefix ?? old.prefix, target: change.target ?? old.target, limit: change.limit === null ? undefined : change.limit ?? old.limit, rollup: change.rollup ?? old.rollup, formula: change.formula ?? old.formula }, db, old.id);
      if (old.mirror) { if (next.target !== old.target) throw new DatabaseError("Turn off its other side first"); next.mirror = old.mirror; }
      checkLinks(ws, page.id, db, next);
      const notes: string[] = [];
      if (type !== old.type) {
        const lost = lostOnTypeChange(ws, page.id, old, type);
        notes.push(`Changed to ${typeLabels[type]}`, ...(lost ? [`${plural(lost, "value")} show${lost === 1 ? "s" : ""} as empty`] : []));
      }
      if (change.options && hasOptions(old.type)) {
        const kept = new Set(next.options!.map((o) => o.id));
        for (const o of old.options ?? []) if (!kept.has(o.id)) { const n = rowsWithOption(ws, page.id, old, o.id); notes.push(n ? `Option "${o.name}" removed from ${plural(n, "row")}` : `Option "${o.name}" removed`); }
      }
      db.properties[db.properties.indexOf(old)] = next;
      if (next.type === "id") numberRows(ws, page);
      return notes.join(" · ") || (next.name !== old.name ? `Renamed to ${next.name}` : "Property saved");
    }
    case "duplicateProperty": {
      const old = property(change.propertyId);
      if (db.properties.length >= limits.properties) throw new DatabaseError("Too many properties");
      if (db.properties.some((p) => p.id === change.newId)) throw new DatabaseError("Invalid id");
      const taken = new Set(["name", ...db.properties.map((p) => p.name.toLocaleLowerCase())]);
      let name = `${old.name} copy`;
      for (let n = 2; taken.has(name.toLocaleLowerCase()); n++) name = `${old.name} copy ${n}`;
      // One side only: a second two-way link to the same rows isn't what a copy means.
      const { mirror: _mirror, ...rest } = old;
      const added = cleanProperty({ ...rest, id: change.newId, name }, db);
      db.properties.splice(db.properties.indexOf(old) + 1, 0, added);
      checkLinks(ws, page.id, db, added);
      if (added.type === "id") numberRows(ws, page);
      else for (const row of ws.pages) if (row.parentId === page.id && row.values && old.id in row.values) row.values = { ...row.values, [added.id]: row.values[old.id]! };
      // Beside it, wherever it shows, at its width; hidden where it's hidden.
      for (const v of db.views) { const at = v.columns.findIndex((c) => c.id === old.id); if (at >= 0) v.columns.splice(at + 1, 0, { ...v.columns[at]!, id: added.id }); }
      return `Added ${name}`;
    }
    case "setDependencies": {
      if (db.fixed) throw new DatabaseError("To-dos can't have dependencies");
      if (!change.on) { delete db.dependencies; return "Dependencies off"; }
      const { blockedBy, blocking, date, end, mode, avoidWeekends, using } = change.on;
      const writable = (id: string | undefined) => { const p = id ? db.properties.find((x) => x.id === id) : undefined; if (!p || p.type !== "date") throw new DatabaseError("Dependencies need a Date property to go by"); };
      writable(date);
      if (end !== undefined) writable(end);
      if (!(["overlap", "keep", "none"] as const).includes(mode)) throw new DatabaseError("Unknown mode");
      if (using) {
        const relation = property(blockedBy);
        if (relation.type !== "relation" || relation.target !== page.id || relation.mirror !== blocking) throw new DatabaseError("Dependencies need a two-way relation to this database");
      } else {
        const free = (name: string) => { let next = name; for (let n = 2; db.properties.some((p) => fold(p.name) === fold(next)); n++) next = `${name} ${n}`; return next; };
        changeDatabase(ws, page, { kind: "addProperty", property: { id: blockedBy, name: free("Blocked by"), type: "relation", target: page.id } });
        changeDatabase(ws, page, { kind: "setMirror", propertyId: blockedBy, mirror: { id: blocking, name: free("Blocking") } });
        for (const v of db.views) v.columns = v.columns.filter((c) => c.id !== blockedBy && c.id !== blocking);
      }
      db.dependencies = { blockedBy, blocking, date, ...(end ? { end } : {}), mode, ...(avoidWeekends ? { avoidWeekends: true as const } : {}) };
      return "Dependencies on";
    }
    case "setSubItems": {
      if (db.fixed) throw new DatabaseError("To-dos' nesting lives on their pages");
      if (!change.on) { delete db.subItems; return "Sub-items off"; }
      const { parent, sub, using } = change.on;
      if (using) {
        const relation = property(parent);
        if (relation.type !== "relation" || relation.target !== page.id || relation.mirror !== sub) throw new DatabaseError("Sub-items need a two-way relation to this database");
        relation.limit = 1;
      } else {
        const free = (name: string) => { let next = name; for (let n = 2; db.properties.some((p) => fold(p.name) === fold(next)); n++) next = `${name} ${n}`; return next; };
        changeDatabase(ws, page, { kind: "addProperty", property: { id: parent, name: free("Parent item"), type: "relation", target: page.id, limit: 1 } });
        changeDatabase(ws, page, { kind: "setMirror", propertyId: parent, mirror: { id: sub, name: free("Sub-item") } });
        // The toggle shows them. Properties can still put them in a view.
        for (const v of db.views) v.columns = v.columns.filter((c) => c.id !== parent && c.id !== sub);
      }
      db.subItems = { parent, sub };
      return "Sub-items on";
    }
    case "removeProperty": {
      const old = property(change.propertyId);
      if (db.subItems && (db.subItems.parent === old.id || db.subItems.sub === old.id)) delete db.subItems;
      if (db.dependencies && [db.dependencies.blockedBy, db.dependencies.blocking, db.dependencies.date, db.dependencies.end].includes(old.id)) delete db.dependencies;
      // Its values stay on the rows, unread, so Undo brings them back with it.
      db.properties = db.properties.filter((p) => p !== old);
      for (const v of db.views) v.columns = v.columns.filter((c) => c.id !== old.id);
      // Its other side goes with it: half a two-way relation would stop being kept in step.
      const other = old.mirror ? mirrorOf(ws, old) : null;
      if (other) {
        other.db.properties = other.db.properties.filter((p) => p !== other.property);
        for (const v of other.db.views) v.columns = v.columns.filter((c) => c.id !== other.property.id);
        return `${old.name} and ${other.property.name} on ${other.title} deleted`;
      }
      return `${old.name} deleted`;
    }
    case "setMirror": {
      const old = property(change.propertyId);
      if (old.type !== "relation") throw new DatabaseError("Not a relation");
      if (change.mirror === null) {
        const other = mirrorOf(ws, old);
        delete old.mirror;
        if (other) {
          other.db.properties = other.db.properties.filter((p) => p !== other.property);
          for (const v of other.db.views) v.columns = v.columns.filter((c) => c.id !== other.property.id);
          return `${other.property.name} removed from ${other.title}`;
        }
        return `${old.name} no longer shows on the other side`;
      }
      if (old.mirror) throw new DatabaseError("Already shown there");
      // To-dos can't have extra properties (design §11): one way only.
      if (old.target === todosSourceId) throw new DatabaseError("To-dos can't show it");
      const target = ws.pages.find((p) => p.id === old.target);
      if (!isDatabase(target)) throw new DatabaseError("That database isn't there");
      if (target.database.properties.length >= limits.properties) throw new DatabaseError("Too many properties");
      if (target.database.properties.some((p) => p.id === change.mirror!.id)) throw new DatabaseError("Invalid id");
      const added = cleanProperty({ id: change.mirror.id, name: change.mirror.name, type: "relation", target: page.id }, target.database);
      added.mirror = old.id;
      target.database.properties.push(added);
      for (const v of target.database.views) v.columns.push({ id: added.id });
      old.mirror = added.id;
      // What this side already links shows on the other.
      for (const row of databaseRows(ws, page.id)) { const raw = row.values?.[old.id]; if (Array.isArray(raw)) syncMirror(ws, old, row.id, [], raw as string[]); }
      return `Shown on ${target.title.trim() || "Untitled"}`;
    }
    case "moveProperty":
      db.properties = move(db.properties, change.propertyId, change.beforeId);
      return "Property moved";
    case "addView": {
      if (db.views.length >= limits.views) throw new DatabaseError("Too many views");
      const added = cleanView(db, change.view);
      if (db.views.some((v) => v.id === added.id)) throw new DatabaseError("Invalid id");
      db.views.push(added);
      return `Added ${added.name}`;
    }
    case "updateView": {
      const old = view(change.viewId);
      const { filterAny: _filterAny, cardImage: _cardImage, wrapName: _wrapName, boardCalculation: _boardCalculation, defaultTemplate: _defaultTemplate, calculations: _calculations, groupBy: _groupBy, groupDateBy: _groupDateBy, hideEmptyGroups: _hideEmptyGroups, hiddenGroups: _hiddenGroups, subGroupBy: _subGroupBy, subGroupDateBy: _subGroupDateBy, hiddenSubGroups: _hiddenSubGroups, dateBy: _dateBy, calendarSpan: _calendarSpan, timelineEnd: _timelineEnd, timelineUnit: _timelineUnit, timelineTable: _timelineTable, openIn: _openIn, colourRules: _colourRules, frozenThrough: _frozenThrough, nameWidth: _nameWidth, ...rest } = old;
      const layout = change.layout !== undefined ? cleanLayout(change.layout) : old.layout;
      const group = cleanGroup(db, {
        groupBy: change.groupBy === null ? undefined : change.groupBy ?? old.groupBy,
        groupDateBy: change.groupDateBy ?? old.groupDateBy,
        hideEmptyGroups: change.hideEmptyGroups ?? old.hideEmptyGroups,
        hiddenGroups: change.hiddenGroups ?? old.hiddenGroups,
        ...(change.subGroupBy === null ? {} : { subGroupBy: change.subGroupBy ?? old.subGroupBy }),
        subGroupDateBy: change.subGroupDateBy ?? old.subGroupDateBy,
        hiddenSubGroups: change.hiddenSubGroups ?? old.hiddenSubGroups,
        dateBy: change.dateBy ?? old.dateBy,
        ...(change.calendarSpan === null ? {} : { calendarSpan: change.calendarSpan ?? old.calendarSpan }),
        ...(change.timelineEnd === null ? {} : { timelineEnd: change.timelineEnd ?? old.timelineEnd }),
        timelineUnit: change.timelineUnit ?? old.timelineUnit,
        ...(change.timelineTable === null ? {} : { timelineTable: change.timelineTable ?? old.timelineTable }),
        ...(change.openIn === null ? {} : { openIn: change.openIn ?? old.openIn }),
        colourRules: change.colourRules ?? old.colourRules,
        ...(change.frozenThrough === null ? {} : { frozenThrough: change.frozenThrough ?? old.frozenThrough }),
        ...(change.nameWidth === null ? {} : { nameWidth: change.nameWidth ?? old.nameWidth }),
      }, layout, old);
      const next: View = {
        ...rest,
        layout,
        ...(change.name !== undefined ? { name: cleanName(change.name, "A view") } : {}),
        ...(change.subItemsDisplay ? { subItemsDisplay: change.subItemsDisplay } : {}),
        ...(change.subItemsShow ? { subItemsShow: change.subItemsShow } : {}),
        ...(change.cardImage !== undefined ? (change.cardImage ? { cardImage: change.cardImage } : {}) : (old.cardImage ? { cardImage: old.cardImage } : {})),
        ...(change.columns !== undefined ? { columns: cleanColumns(db, change.columns) } : {}),
        ...(change.sort !== undefined ? { sort: cleanSort(db, change.sort, old.sort) } : {}),
        ...(change.filter !== undefined ? { filter: cleanFilter(db, change.filter, old.filter) } : {}),
        ...((change.filterAny ?? old.filterAny) ? { filterAny: true as const } : {}),
        ...((change.wrapName ?? old.wrapName) ? { wrapName: true as const } : {}),
        ...(() => { const chosen = change.boardCalculation === undefined ? old.boardCalculation : change.boardCalculation; return chosen ? { boardCalculation: cleanBoardCalculation(db, chosen) } : {}; })(),
        ...(() => { const template = change.defaultTemplate === undefined ? old.defaultTemplate : change.defaultTemplate; return template ? { defaultTemplate: template } : {}; })(),
        ...(() => { const calculations = change.calculations !== undefined ? cleanCalculations(db, change.calculations) : old.calculations; return calculations && Object.keys(calculations).length ? { calculations } : {}; })(),
        ...group,
      };
      db.views[db.views.indexOf(old)] = next;
      return "View saved";
    }
    case "setRepeat": {
      const template = ws.pages.find((p) => p.id === change.templateId);
      if (!template || template.parentId !== rowTemplateTarget(page.id)) throw new DatabaseError("That template's gone");
      const repeats = { ...db.repeats };
      if (!change.repeat) delete repeats[change.templateId];
      else {
        const r = change.repeat;
        if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 999) throw new DatabaseError("Every how many?");
        if (!validDateText(r.start) || r.start.length !== 10) throw new DatabaseError("Invalid start date");
        if (r.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw new DatabaseError("Invalid time");
        if (r.weekdays?.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new DatabaseError("Invalid weekday");
        const weekdays = r.every === "week" && r.weekdays?.length ? [...new Set(r.weekdays)].sort((a, b) => a - b) : null;
        const had = repeats[change.templateId];
        // Changing the schedule keeps what it last made, so a period it's made doesn't come round again.
        repeats[change.templateId] = { every: r.every, interval: r.interval, start: r.start, ...(weekdays ? { weekdays } : {}), ...(r.time ? { time: r.time } : {}), ...(r.paused ? { paused: true as const } : {}), ...(r.everyMissed ? { everyMissed: true as const } : {}), ...(r.notBefore ? { notBefore: r.notBefore } : {}), ...(had?.last ? { last: had.last } : {}), ...(had?.lastRan ? { lastRan: had.lastRan } : {}) };
      }
      if (Object.keys(repeats).length) db.repeats = repeats; else delete db.repeats;
      return change.repeat ? "Repeat set" : "Repeat off";
    }
    case "setDefaultTemplate": {
      if (change.templateId) db.defaultTemplate = checkId(change.templateId); else delete db.defaultTemplate;
      return change.templateId ? "Default for all views" : "No default";
    }
    case "removeView": {
      const old = view(change.viewId);
      if (db.views.length === 1) throw new DatabaseError("A database keeps at least one view");
      db.views = db.views.filter((v) => v !== old);
      return `${old.name} deleted`;
    }
    case "moveView":
      db.views = move(db.views, change.viewId, change.beforeId);
      return "View moved";
    default:
      throw new DatabaseError("Unknown change");
  }
}

/**
 * One row's edit checked against the row as it is: refused "Changed elsewhere" only when a column it names in
 * `expected` changed since, so edits to other cells or rows meanwhile never refuse it (model §5.2).
 */
export function editRow(db: Database, row: Page, edit: RowEdit, at: string): void {
  const keys = Object.keys(edit.values ?? {});
  if (keys.includes(rowNumberKey)) throw new DatabaseError("Not a value for this property");
  if (!keys.length || keys.length > limits.properties + 1) throw new DatabaseError("Nothing to save");
  for (const [key, want] of Object.entries(edit.expected ?? {})) if (!sameRaw(rawOf(row, key), want)) throw new DatabaseError("Changed elsewhere");
  const values: RawValues = { ...(row.values ?? {}) };
  for (const key of keys) {
    const input = edit.values[key];
    if (key === titleId) {
      if (typeof input !== "string" && input !== null) throw new DatabaseError("Invalid title");
      const title = (input ?? "").replace(/\u0000/g, "").trim();
      if (title.length > 1000) throw new DatabaseError("Text exceeds limit");
      row.title = title;
      continue;
    }
    const property = db.properties.find((p) => p.id === key);
    if (!property) throw new DatabaseError("Property not found");
    const stored = storedValue(property, input);
    if (stored === undefined) delete values[key]; else values[key] = stored;
  }
  if (Object.keys(values).length) row.values = values; else delete row.values;
  row.editedAt = at;
}
/** Values for a new row, each checked against its property. */
export function newRowStored(db: Database, input: Record<string, Json> | undefined): RawValues | undefined {
  const values: RawValues = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    const property = db.properties.find((p) => p.id === key);
    if (!property) throw new DatabaseError("Property not found");
    const stored = storedValue(property, raw);
    if (stored !== undefined) values[key] = stored;
  }
  return Object.keys(values).length ? values : undefined;
}

/** A cell as text: option names, a date range with an arrow, a ticked box as "Yes". */
export function valueText(db: Database, columnId: string, value: CellValue): string {
  const property = propertyOf(db, columnId)
  const name = (id: string) => property?.options?.find(o => o.id === id)?.name ?? ''
  if (value === null || value === false) return ''
  if (property?.type === 'createdTime' || property?.type === 'editedTime') return (value as DateValue).start.replace('T', ' ')
  if (property?.type === 'id') return `${property.prefix ?? ''}${value}`
  if (value === true) return 'Yes'
  if (property?.type === 'files') return (value as FileValue[]).map(f => f.name).join(', ')
  if (Array.isArray(value)) return (value as string[]).map(name).filter(Boolean).join(', ')
  if (typeof value === 'object') return value.end ? `${value.start} → ${value.end}` : value.start
  if (property && (property.type === 'select' || property.type === 'status')) return name(String(value))
  return String(value)
}
