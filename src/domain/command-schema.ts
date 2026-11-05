import { z } from "zod";
import { calcKinds, rollupFunctions, filterOpList, limits, propertyTypes, viewLayouts, type Json } from "./database.ts";
const id = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const title = z.string().max(1000);
const status = z.enum(["open", "done", "cancelled"]);
// Databases: the shapes here bound sizes; `database.ts` checks the values against the schema.
const json: z.ZodType<Json> = z.lazy(() => z.union([z.string().max(10_000), z.number(), z.boolean(), z.null(), z.array(json).max(200), z.record(z.string().max(200), json)]));
const at = z.string().max(40);
const values = z.record(z.string().min(1).max(200), json);
const rowEdit = z.object({ pageId: id, values, expected: values, databaseId: id.optional() });
const option = z.object({ id, name: z.string().max(200), group: z.enum(["todo", "active", "done"]).optional(), from: z.string().max(200).optional() });
const propertyFields = { button: z.object({ label: z.string().max(200), steps: z.string().max(200_000) }).optional(), name: z.string().max(200), type: z.enum(propertyTypes), options: z.array(option).max(200).optional(), format: z.enum(["plain", "comma", "percent", "currency"]).optional(), withTime: z.boolean().optional(), prefix: z.string().max(limits.prefix + 100).optional(), target: id.optional(), limit: z.literal(1).nullable().optional(), rollup: z.object({ relation: id, property: id, fn: z.enum(rollupFunctions) }).optional(), formula: z.string().max(limits.formula).optional() };
const columns = z.array(z.object({ id, width: z.number().int().optional(), wrap: z.literal(true).optional() })).max(100);
const sort = z.array(z.object({ by: id, direction: z.enum(["asc", "desc"]) })).max(10);
const filter = z.array(z.object({ by: id, op: z.enum(filterOpList), value: json.optional() })).max(20);
// Three layers with the top one, so the shape holds the limit and nothing has to recurse on what a client sends.
const innerFilterGroup = z.object({ any: z.literal(true).optional(), rules: filter });
const filterGroups = z.array(innerFilterGroup.extend({ groups: z.array(innerFilterGroup).max(20).optional() })).max(20);
const groupDateBy = z.enum(["day", "week", "month"]);
const hiddenGroups = z.array(z.string().max(200)).max(limits.hiddenGroups);
const calculations = z.record(id, z.enum(calcKinds));
const boardCalculation = z.object({ by: id, kind: z.enum(calcKinds) });
const colourRules = z.array(z.object({ id, rule: z.object({ by: id, op: z.enum(filterOpList), value: json.optional() }), tint: z.enum(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]), scope: z.literal("property").optional() })).max(50);
const timelineUnit = z.enum(["hours", "day", "week", "month", "quarter", "year"]);
const view = z.object({ id, subItemsDisplay: z.enum(["nested", "flat"]).optional(), subItemsShow: z.enum(["both", "parents", "subs"]).optional(), name: z.string().max(200), layout: z.enum(viewLayouts), columns, sort, filter, filterGroups: filterGroups.optional(), groupBy: id.optional(), groupDateBy: groupDateBy.optional(), hideEmptyGroups: z.boolean().optional(), hiddenGroups: hiddenGroups.optional(), subGroupBy: id.optional(), subGroupDateBy: groupDateBy.optional(), hiddenSubGroups: hiddenGroups.optional(), dateBy: id.optional(), calendarSpan: z.literal("week").optional(), timelineEnd: id.optional(), timelineUnit: timelineUnit.optional(), timelineTable: z.literal(true).optional(), openIn: z.enum(["center", "side"]).optional(), colourRules: colourRules.optional(), frozenThrough: id.optional(), nameWidth: z.number().int().optional(), filterAny: z.literal(true).optional(), wrapName: z.literal(true).optional(), calculations: calculations.optional(), boardCalculation: boardCalculation.optional(), defaultTemplate: id.optional() });
const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addProperty"), property: z.object({ id, ...propertyFields }), viewId: id.optional(), beforeId: id.optional() }),
  z.object({ kind: z.literal("updateProperty"), propertyId: id, ...propertyFields, name: propertyFields.name.optional(), type: propertyFields.type.optional() }),
  z.object({ kind: z.literal("removeProperty"), propertyId: id }),
  z.object({ kind: z.literal("duplicateProperty"), propertyId: id, newId: id }),
  z.object({ kind: z.literal("setDependencies"), on: z.object({ blockedBy: id, blocking: id, date: id, end: id.optional(), mode: z.enum(["overlap", "keep", "none"]), avoidWeekends: z.boolean().optional(), using: z.boolean().optional() }).nullable() }),
  z.object({ kind: z.literal("setSubItems"), on: z.object({ parent: id, sub: id, using: z.boolean().optional() }).nullable() }),
  z.object({ kind: z.literal("setMirror"), propertyId: id, mirror: z.object({ id, name: z.string().max(200) }).nullable() }),
  z.object({ kind: z.literal("moveProperty"), propertyId: id, beforeId: id.nullable() }),
  z.object({ kind: z.literal("addView"), view }),
  z.object({ kind: z.literal("updateView"), viewId: id, cardImage: id.nullable().optional(), subItemsDisplay: z.enum(["nested", "flat"]).optional(), subItemsShow: z.enum(["both", "parents", "subs"]).optional(), name: z.string().max(200).optional(), columns: columns.optional(), sort: sort.optional(), filter: filter.optional(), filterGroups: filterGroups.optional(), layout: z.enum(viewLayouts).optional(), groupBy: id.nullable().optional(), groupDateBy: groupDateBy.optional(), hideEmptyGroups: z.boolean().optional(), hiddenGroups: hiddenGroups.optional(), subGroupBy: id.nullable().optional(), subGroupDateBy: groupDateBy.optional(), hiddenSubGroups: hiddenGroups.optional(), dateBy: id.optional(), calendarSpan: z.literal("week").nullable().optional(), timelineEnd: id.nullable().optional(), timelineUnit: timelineUnit.optional(), timelineTable: z.literal(true).nullable().optional(), openIn: z.enum(["center", "side"]).nullable().optional(), colourRules: colourRules.optional(), frozenThrough: id.nullable().optional(), nameWidth: z.number().int().nullable().optional(), filterAny: z.boolean().optional(), wrapName: z.boolean().optional(), calculations: calculations.optional(), boardCalculation: boardCalculation.nullable().optional(), defaultTemplate: id.nullable().optional() }),
  z.object({ kind: z.literal("setRepeat"), templateId: id, repeat: z.object({ every: z.enum(["day", "week", "month", "year"]), interval: z.number().int(), start: z.string().max(10), weekdays: z.array(z.number().int()).max(7).optional(), time: z.string().max(5).optional(), paused: z.literal(true).optional(), everyMissed: z.literal(true).optional(), notBefore: z.string().max(16).optional() }).nullable() }),
  z.object({ kind: z.literal("setDefaultTemplate"), templateId: id.nullable() }),
  z.object({ kind: z.literal("removeView"), viewId: id }),
  z.object({ kind: z.literal("moveView"), viewId: id, beforeId: id.nullable() }),
]);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-editor"), pageId: id, expectedContent: z.string().max(200), document: z.string().max(2_000_000), singleDeleteIds: z.array(id).max(100).optional(), cutTaskIds: z.array(id).max(200).optional(),
    detachDatabaseIds: z.array(id).max(50).optional(), adoptDatabaseBlocks: z.array(z.object({ blockId: id, pageId: id })).max(50).optional(), today: day.optional(), at: at.optional() }),
  z.object({ type: z.literal("ensure-day"), date: day }),
  z.object({ type: z.literal("add-task"), pageId: id, title: title.min(1), plannedOn: day.nullable().optional(), attentionOn: day.nullable().optional(), deadlineOn: day.nullable().optional() }),
  z.object({ type: z.literal("task-status"), taskId: id, status, today: day.optional() }),
  z.object({ type: z.literal("rename-task"), taskId: id, title: z.string().max(1000) }),
  z.object({ type: z.literal("unsync-block"), pageId: id, blockId: id, all: z.literal(true).optional() }),
  z.object({ type: z.literal("delete-synced-place"), pageId: id, blockId: id }),
  z.object({ type: z.literal("set-task-dates"), taskId: id, attentionOn: day.nullable().optional(), deadlineOn: day.nullable().optional() }),
  z.object({ type: z.literal("plan-task"), taskId: id, date: day, from: day.optional(), today: day.optional() }),
  z.object({ type: z.literal("plan-tasks"), date: day, items: z.array(z.object({ taskId: id })).min(1).max(100) }),
  z.object({ type: z.literal("not-today"), taskId: id, date: day, onlyThisDay: z.literal(true).optional() }),
  z.object({ type: z.literal("remove-task-row"), pageId: id, taskId: id, today: day }),
  z.object({ type: z.literal("bring-line"), date: day, sourcePageId: id, sourceBlockId: id }),
  z.object({ type: z.literal("handoff-done"), date: day }),
  z.object({ type: z.literal("save-review"), date: day }),
  z.object({ type: z.literal("create-document"), title, body: z.string().max(100_000), pageId: id.optional(), parentId: id.optional() }),
  z.object({ type: z.literal("make-link-pages"), parentPageId: id, items: z.array(z.object({ url: z.string().min(1).max(10_000), pageId: id, title: title.optional() })).min(1).max(50), at: at.optional() }),
  z.object({ type: z.literal("apply-link-preview"), pageId: id, url: z.string().min(1).max(10_000), title: z.string().max(2000).nullable(), description: z.string().max(5000).nullable() }),
  z.object({ type: z.literal("rename-page"), pageId: id, title }),
  z.object({ type: z.literal("run-row-button"), databaseId: id, propertyId: id, rowIds: z.array(id).min(1).max(limits.rowsAtOnce), stepsKey: z.string().max(200), at: z.string().max(40), today: z.string().max(10) }),
  z.object({ type: z.literal("run-button"), pageId: id, blockId: id, stepsKey: z.string().max(200), expectedContent: z.string().max(200), at: z.string().max(40), today: z.string().max(10) }),
  z.object({ type: z.literal("add-comment"), pageId: id, threadId: id, commentId: id, body: z.string().max(20_000), at: z.string().max(40) }),
  z.object({ type: z.literal("edit-comment"), threadId: id, commentId: id, body: z.string().max(20_000), version: z.number().int().nonnegative(), at: z.string().max(40) }),
  z.object({ type: z.literal("delete-comment"), threadId: id, commentId: id, version: z.number().int().nonnegative() }),
  z.object({ type: z.literal("resolve-thread"), threadId: id, resolved: z.boolean(), version: z.number().int().nonnegative(), at: z.string().max(40) }),
  z.object({ type: z.literal("set-page-icon"), pageId: id, icon: z.string().max(300).nullable() }),
  z.object({ type: z.literal("set-page-cover"), pageId: id, cover: z.string().max(2000).nullable(), position: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal("move-page"), pageId: id, parentId: id.nullable(), beforeId: id.nullable().optional() }),
  z.object({ type: z.literal("delete-page"), pageId: id, at: z.string().max(40) }),
  z.object({ type: z.literal("restore-page"), pageId: id }),
  z.object({ type: z.literal("restore-batch"), trashId: id }),
  z.object({ type: z.literal("create-template"), databaseId: id.optional(), title: z.string().max(1000), pageId: z.string().min(1).max(200).optional(), dayPage: z.literal(true).optional() }),
  z.object({ type: z.literal("set-template-target"), pageId: z.string().min(1).max(200), target: z.string().min(1).max(200).nullable() }),
  z.object({ type: z.literal("delete-template"), pageId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("set-draft"), pageId: id, status: z.enum(["preparing", "ready", "failed"]), moreOpen: z.array(id).max(200), allowedTaskIds: z.array(id).max(500),
    items: z.array(z.object({ id: z.string().min(1).max(100), anchor: z.string().max(200), place: z.enum(["fill", "after"]), taskId: id.optional(), source: z.enum(["model", "fallback"]), state: z.literal("open"),
      block: z.object({ id: z.string().min(1).max(200), type: z.enum(["paragraph", "bulletListItem", "task"]), props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), content: z.array(z.unknown()).max(50), children: z.array(z.never()).max(0).optional() }).optional() })).max(50) }),
  z.object({ type: z.literal("apply-draft"), pageId: id, itemIds: z.array(z.string().min(1).max(100)).min(1).max(50), edits: z.record(z.string().max(100), z.string().max(500)).optional(), today: day.optional() }),
  z.object({ type: z.literal("skip-draft"), pageId: id, itemIds: z.array(z.string().min(1).max(100)).min(1).max(50) }),
  z.object({ type: z.literal("create-database"), pageId: id, parentId: id.nullable().optional(), homeBlockId: id.nullable(), title }),
  z.object({ type: z.literal("change-database"), pageId: id, change }),
  z.object({ type: z.literal("move-row"), pageId: id, databaseId: id, at }),
  z.object({ type: z.literal("add-rows"), databaseId: id, rows: z.array(z.object({ pageId: id, title, values: values.optional() })).min(1).max(10_000), at }),
  z.object({ type: z.literal("import-csv"), databaseId: id, create: z.object({ parentId: id.nullable().optional(), homeBlockId: id.nullable(), title }).optional(), changes: z.array(change).max(200), rows: z.array(z.object({ pageId: id, title, values: values.optional() })).max(10_000), at }),
  z.object({ type: z.literal("paste-cells"), databaseId: id, items: z.array(rowEdit).max(1000), rows: z.array(z.object({ pageId: id, title, values: values.optional() })).max(1000), at }),
  z.object({ type: z.literal("run-repeats"), today: day, time: z.string().regex(/^\d{2}:\d{2}$/), at }),
  z.object({ type: z.literal("add-row"), databaseId: id, pageId: id, title, values: values.optional(), beforeId: id.nullable().optional(), copyOf: id.optional(), template: id.optional(), at }),
  z.object({ type: z.literal("set-values"), ...rowEdit.shape, beforeId: id.nullable().optional(), newTodos: z.array(z.object({ id, title: title.min(1), on: day })).max(100).optional(), at }),
  z.object({ type: z.literal("set-values-many"), items: z.array(rowEdit).min(1).max(limits.rowsAtOnce), at }),
  z.object({ type: z.literal("edit-todos"), items: z.array(z.object({ taskId: id, changes: z.array(z.object({ columnId: id, value: json })).min(1).max(4) })).min(1).max(limits.todosAtOnce), today: day }),
  z.object({ type: z.literal("delete-pages"), pageIds: z.array(id).min(1).max(limits.rowsAtOnce), at }),
  z.object({ type: z.literal("set-timezone"), timezone: z.string().min(1).max(100) }),
  z.object({ type: z.literal("set-week-start"), weekStart: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal("undo"), targetOperationId: id }),
]);
export const commandSchema = z.object({
  operationId: id,
  expectedRevision: z.number().int().nonnegative(),
  action,
});
