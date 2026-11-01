// Databases (docs/design/databases-model.md): a database is a page with `database` (its properties and views); a row
// is a child page with `values`. Values are read through their property, never trusted as stored, so a schema change
// rewrites only the database page. Pure: the domain's commands and the browser's views share it.
import type { LocalDate, Page, Workspace } from "./types.ts";

export const propertyTypes = ["text", "number", "select", "multiSelect", "status", "date", "checkbox", "url"] as const;
export type PropertyType = (typeof propertyTypes)[number];
export type NumberFormat = "plain" | "comma" | "percent" | "currency";
export type StatusGroup = "todo" | "active" | "done";

export interface Option { id: string; name: string; /** status only */ group?: StatusGroup }
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
}
export interface DateValue { start: string; end?: string }
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
export interface View {
  id: string;
  name: string;
  layout: "table";
  /** Shown properties, in order, with widths; one not listed is hidden. The title column is always shown first and is not listed. */
  columns: { id: string; width?: number }[];
  sort: Sort[];
  /** All must hold. */
  filter: Condition[];
}
export interface Database {
  /** The `database` block that is its place in its parent page; null: shown as a full page. */
  homeBlockId: string | null;
  properties: Property[];
  /** At least one. */
  views: View[];
}
export type RawValues = Record<string, Json>;
/** What a cell shows: the typed value, or null for empty (checkbox: false). */
export type CellValue = string | number | string[] | DateValue | boolean | null;

/** The column id of a row's title, in views, sorts, filters and `set-values`. */
export const titleId = "title";
export const databaseBlockType = "database";
export const limits = { properties: 100, options: 200, views: 50, conditions: 20, sorts: 10, text: 10_000, name: 200, multi: 100, rowsAtOnce: 200 } as const;

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
  return dayPattern.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` local wall time in the workspace's zone (like `@date` chips). */
export function validDateText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (dayPattern.test(value)) return validDay(value);
  if (!timePattern.test(value)) return false;
  const [h, m] = value.slice(11).split(":").map(Number);
  return validDay(value.slice(0, 10)) && h! < 24 && m! < 60;
}
const optionIds = (p: Property): Set<string> => new Set((p.options ?? []).map((o) => o.id));
function parseNumber(value: string): number | null {
  const s = value.trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * The value a cell shows, read from what the row stores. Where a type change makes the reading obvious (number and
 * text, select, status and multi-select by option id, text and url) it converts; anything else reads as empty, so
 * changing the type back shows the stored value again.
 */
export function readValue(property: Property, raw: unknown): CellValue {
  const ids = optionIds(property);
  switch (property.type) {
    case "text":
    case "url": {
      if (typeof raw === "string") return raw === "" ? null : (property.options?.find((o) => o.id === raw)?.name ?? raw);
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
      if (Array.isArray(raw)) { const names = raw.map((id) => property.options?.find((o) => o.id === id)?.name).filter((x): x is string => Boolean(x)); return names.length ? names.join(", ") : null; }
      return null;
    }
    case "number":
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      return typeof raw === "string" ? parseNumber(raw) : null;
    case "select":
    case "status": {
      const picked = typeof raw === "string" && ids.has(raw) ? raw : Array.isArray(raw) ? raw.find((x) => typeof x === "string" && ids.has(x)) ?? null : null;
      // The design (§6.1): a status always has a value, the first To-do option.
      if (picked === null && property.type === "status") return property.options?.find((o) => o.group === "todo")?.id ?? property.options?.[0]?.id ?? null;
      return picked;
    }
    case "multiSelect": {
      const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
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
    case "text":
    case "url": {
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
  return property ? readValue(property, rawOf(row, columnId)) : null;
}

/** The rows whose stored value for this property reads differently as `type`: the "N values show as empty" count. */
export function lostOnTypeChange(ws: Workspace, databaseId: string, property: Property, type: PropertyType): number {
  const next = { ...property, type };
  return databaseRows(ws, databaseId).filter((r) => {
    const raw = r.values?.[property.id];
    return raw !== undefined && !isEmptyValue(readValue(property, raw)) && isEmptyValue(readValue(next, raw));
  }).length;
}
/** Rows holding this option: the "removed from N rows" count. */
export function rowsWithOption(ws: Workspace, databaseId: string, property: Property, optionId: string): number {
  return databaseRows(ws, databaseId).filter((r) => {
    const v = readValue(property, r.values?.[property.id]);
    return v === optionId || (Array.isArray(v) && v.includes(optionId));
  }).length;
}

// ---------------------------------------------------------------- views: filter and sort

export interface ViewContext { today: LocalDate; /** The date of the day page the block is on; null elsewhere. */ pageDate: LocalDate | null }

function addDays(day: LocalDate, days: number): LocalDate {
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
/** The days `within` covers, both ends included. Weeks start on Monday. */
function withinRange(within: unknown, today: LocalDate): [LocalDate, LocalDate] | null {
  if (within === "past7") return [addDays(today, -6), today];
  if (within === "next7") return [today, addDays(today, 6)];
  if (within === "thisWeek") { const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7)); return [monday, addDays(monday, 6)]; }
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
    case "text":
    case "url": {
      if (typeof want !== "string") return null;
      const have = typeof value === "string" ? fold(value) : "";
      if (op === "contains") return have.includes(fold(want));
      if (op === "doesNotContain") return !have.includes(fold(want));
      if (op === "is") return have === fold(want);
      if (op === "isNot") return have !== fold(want);
      return null;
    }
    case "number": {
      if (typeof want !== "number" || !Number.isFinite(want)) return null;
      if (typeof value !== "number") return op === "ne";
      const cmp = { eq: value === want, ne: value !== want, gt: value > want, lt: value < want, gte: value >= want, lte: value <= want } as Record<string, boolean>;
      return op in cmp ? cmp[op]! : null;
    }
    case "select":
    case "status":
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
    case "date": {
      const start = value && typeof value === "object" && !Array.isArray(value) ? value.start.slice(0, 10) : null;
      const end = value && typeof value === "object" && !Array.isArray(value) ? (value.end ?? value.start).slice(0, 10) : null;
      if (op === "within") {
        const range = withinRange(want, context.today);
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
export function rowMatches(db: Database, row: Page, filter: readonly Condition[], context: ViewContext): boolean {
  return filter.every((c) => {
    const property = propertyOf(db, c.by);
    // A filter on a deleted property is shown struck through and ignored (design §13).
    return !property || conditionHolds(property, c, cellValue(db, row, c.by), context) !== false;
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Sort keys compare within one type: text by collation, numbers and dates by value, options by their order. Empty is never compared. */
function compareValues(property: Property, a: CellValue, b: CellValue): number {
  const order = (id: unknown) => (property.options ?? []).findIndex((o) => o.id === id);
  switch (property.type) {
    case "text":
    case "url":
      return collator.compare(String(a), String(b));
    case "number":
      return (a as number) - (b as number);
    case "select":
    case "status":
      return order(a) - order(b);
    case "multiSelect": {
      const x = (a as string[]).map(order).sort((p, q) => p - q), y = (b as string[]).map(order).sort((p, q) => p - q);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return x.length - y.length;
    }
    case "date":
      return (a as DateValue).start.localeCompare((b as DateValue).start);
    case "checkbox":
      return Number(a) - Number(b);
  }
}
/** The rows a view shows: live rows, filtered (all conditions), then sorted by each key in turn; empty last; ties keep page order. */
export function viewRows(ws: Workspace, databaseId: string, view: View, context: ViewContext): Page[] {
  const page = ws.pages.find((p) => p.id === databaseId);
  if (!isDatabase(page)) return [];
  const db = page.database;
  const rows = databaseRows(ws, databaseId).filter((r) => rowMatches(db, r, view.filter, context));
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
export function viewColumns(db: Database, view: View): { property: Property; width?: number }[] {
  return view.columns.flatMap((c) => { const property = db.properties.find((p) => p.id === c.id); return property ? [{ property, ...(c.width !== undefined ? { width: c.width } : {}) }] : []; });
}

/**
 * A new row in a filtered view (design §7.4): the values that keep it in sight where one value fits a condition, and
 * whether the row will be shown at all ("Added · hidden by this view's filter · Show" when not).
 */
export function newRowValues(db: Database, view: View, context: ViewContext): { title: string; values: RawValues; visible: boolean } {
  let title = "";
  const values: RawValues = {};
  for (const c of view.filter) {
    const property = propertyOf(db, c.by);
    if (!property) continue;
    const want = c.value;
    let value: Json | undefined;
    if (property.type === "text" || property.type === "url") { if (c.op === "is" && typeof want === "string") value = want; }
    else if (property.type === "number") { if (c.op === "eq" && typeof want === "number") value = want; }
    else if (property.type === "select" || property.type === "status") { const ids = strings(want); if (["isAnyOf", "is"].includes(c.op) && ids.length === 1) value = ids[0]; }
    else if (property.type === "multiSelect") { const ids = strings(want); if (["isAnyOf", "contains"].includes(c.op) && ids.length === 1) value = [ids[0]]; }
    else if (property.type === "checkbox") { if (c.op === "is" && want === true) value = true; }
    else if (property.type === "date") { const day = c.op === "is" ? resolveDateRef(want, context) : null; if (day) value = { start: day }; }
    if (value === undefined) continue;
    try { value = storedValue(property, value); } catch { continue; }
    if (value === undefined) continue;
    if (property.id === titleId) title = value as string; else values[property.id] = value;
  }
  const probe = { id: "", type: "document", date: null, title, document: "[]", values } as Page;
  return { title, values, visible: rowMatches(db, probe, view.filter, context) };
}

// ---------------------------------------------------------------- commands' inputs

/** A property as `addProperty` sends it: options without ids get them; a Status with none gets the three groups. */
export interface PropertyInput { id: string; name: string; type: PropertyType; options?: Option[]; format?: NumberFormat; withTime?: boolean }
/** One schema or view change: one write, the database page. */
export type DatabaseChange =
  | { kind: "addProperty"; property: PropertyInput; /** the view it was added from: it shows there; other views list it too */ viewId?: string }
  | { kind: "updateProperty"; propertyId: string; name?: string; type?: PropertyType; options?: Option[]; format?: NumberFormat; withTime?: boolean }
  | { kind: "removeProperty"; propertyId: string }
  | { kind: "moveProperty"; propertyId: string; beforeId: string | null }
  | { kind: "addView"; view: View }
  | { kind: "updateView"; viewId: string; name?: string; columns?: View["columns"]; sort?: Sort[]; filter?: Condition[] }
  | { kind: "removeView"; viewId: string }
  | { kind: "moveView"; viewId: string; beforeId: string | null };
/** One row's edit: values by column id (`title` for the title), null clears; `expected`: those columns as the edit saw them. */
export interface RowEdit { pageId: string; values: Record<string, Json>; expected: Record<string, Json> }

// ---------------------------------------------------------------- schema and view changes

const filterOps = new Set<string>(filterOpList);
const statusGroups = new Set<StatusGroup>(["todo", "active", "done"]);
const numberFormats = new Set<NumberFormat>(["plain", "comma", "percent", "currency"]);
export const typeLabels: Record<PropertyType, string> = { text: "Text", number: "Number", select: "Select", multiSelect: "Multi-select", status: "Status", date: "Date", checkbox: "Checkbox", url: "URL" };
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
    if (type !== "status") return o.group && statusGroups.has(o.group) ? { id, name, group: o.group } : { id, name };
    return { id, name, group: o.group && statusGroups.has(o.group) ? o.group : "todo" };
  });
}
function uniqueName(db: Database, name: string, except?: string): void {
  if (fold(name) === fold(titleProperty.name) || db.properties.some((p) => p.id !== except && fold(p.name) === fold(name))) throw new DatabaseError(`There's already a property "${name}"`);
}
function cleanProperty(input: PropertyInput, db: Database, except?: string): Property {
  if (!input || !(propertyTypes as readonly string[]).includes(input.type)) throw new DatabaseError("Unknown property type");
  const property: Property = { id: checkId(input.id), name: cleanName(input.name, "A property"), type: input.type };
  uniqueName(db, property.name, except);
  if (input.options !== undefined) property.options = cleanOptions(input.options, input.type);
  if (input.type === "status" && !property.options?.length) property.options = defaultStatusOptions();
  if (input.format !== undefined) { if (!numberFormats.has(input.format)) throw new DatabaseError("Unknown number format"); property.format = input.format; }
  if (input.withTime !== undefined) { if (typeof input.withTime !== "boolean") throw new DatabaseError("Invalid property"); if (input.withTime) property.withTime = true; }
  return property;
}
const knownColumn = (db: Database, id: unknown): boolean => typeof id === "string" && (id === titleId || db.properties.some((p) => p.id === id));
function cleanColumns(db: Database, input: unknown): View["columns"] {
  if (!Array.isArray(input) || input.length > limits.properties) throw new DatabaseError("Invalid view");
  const seen = new Set<string>();
  return input.map((c: { id: string; width?: number }) => {
    if (!c || !knownColumn(db, c.id) || c.id === titleId || seen.has(c.id)) throw new DatabaseError("Invalid view");
    seen.add(c.id);
    if (c.width === undefined) return { id: c.id };
    if (!Number.isInteger(c.width) || c.width < 40 || c.width > 2000) throw new DatabaseError("Invalid view");
    return { id: c.id, width: c.width };
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
function cleanView(db: Database, input: View): View {
  if (!input || input.layout !== "table") throw new DatabaseError("Unknown view type");
  return { id: checkId(input.id), name: cleanName(input.name, "A view"), layout: "table", columns: cleanColumns(db, input.columns), sort: cleanSort(db, input.sort, []), filter: cleanFilter(db, input.filter, []) };
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

/** Applies one change to the database page in place; returns the receipt's message. */
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
      // A new property shows in every view, at the end (Notion shows it where it was made; one person rarely needs it hidden elsewhere).
      for (const v of db.views) v.columns.push({ id: added.id });
      return `Added ${added.name}`;
    }
    case "updateProperty": {
      const old = property(change.propertyId);
      const type = change.type ?? old.type;
      const next = cleanProperty({ id: old.id, name: change.name ?? old.name, type, options: change.options ?? old.options, format: change.format ?? old.format, withTime: change.withTime ?? old.withTime }, db, old.id);
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
      return notes.join(" · ") || (next.name !== old.name ? `Renamed to ${next.name}` : "Property saved");
    }
    case "removeProperty": {
      const old = property(change.propertyId);
      // Its values stay on the rows, unread, so Undo brings them back with it.
      db.properties = db.properties.filter((p) => p !== old);
      for (const v of db.views) v.columns = v.columns.filter((c) => c.id !== old.id);
      return `${old.name} deleted`;
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
      const next: View = {
        ...old,
        ...(change.name !== undefined ? { name: cleanName(change.name, "A view") } : {}),
        ...(change.columns !== undefined ? { columns: cleanColumns(db, change.columns) } : {}),
        ...(change.sort !== undefined ? { sort: cleanSort(db, change.sort, old.sort) } : {}),
        ...(change.filter !== undefined ? { filter: cleanFilter(db, change.filter, old.filter) } : {}),
      };
      db.views[db.views.indexOf(old)] = next;
      return "View saved";
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
