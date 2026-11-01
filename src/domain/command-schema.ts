import { z } from "zod";
import { filterOpList, propertyTypes, type Json } from "./database.ts";
const id = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const title = z.string().max(1000);
const status = z.enum(["open", "done", "cancelled"]);
// Databases: the shapes here bound sizes; `database.ts` checks the values against the schema.
const json: z.ZodType<Json> = z.lazy(() => z.union([z.string().max(10_000), z.number(), z.boolean(), z.null(), z.array(json).max(200), z.record(z.string().max(200), json)]));
const at = z.string().max(40);
const values = z.record(z.string().min(1).max(200), json);
const rowEdit = z.object({ pageId: id, values, expected: values });
const option = z.object({ id, name: z.string().max(200), group: z.enum(["todo", "active", "done"]).optional() });
const propertyFields = { name: z.string().max(200), type: z.enum(propertyTypes), options: z.array(option).max(200).optional(), format: z.enum(["plain", "comma", "percent", "currency"]).optional(), withTime: z.boolean().optional() };
const columns = z.array(z.object({ id, width: z.number().int().optional() })).max(100);
const sort = z.array(z.object({ by: id, direction: z.enum(["asc", "desc"]) })).max(10);
const filter = z.array(z.object({ by: id, op: z.enum(filterOpList), value: json.optional() })).max(20);
const view = z.object({ id, name: z.string().max(200), layout: z.literal("table"), columns, sort, filter });
const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addProperty"), property: z.object({ id, ...propertyFields }), viewId: id.optional() }),
  z.object({ kind: z.literal("updateProperty"), propertyId: id, ...propertyFields, name: propertyFields.name.optional(), type: propertyFields.type.optional() }),
  z.object({ kind: z.literal("removeProperty"), propertyId: id }),
  z.object({ kind: z.literal("moveProperty"), propertyId: id, beforeId: id.nullable() }),
  z.object({ kind: z.literal("addView"), view }),
  z.object({ kind: z.literal("updateView"), viewId: id, name: z.string().max(200).optional(), columns: columns.optional(), sort: sort.optional(), filter: filter.optional() }),
  z.object({ kind: z.literal("removeView"), viewId: id }),
  z.object({ kind: z.literal("moveView"), viewId: id, beforeId: id.nullable() }),
]);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-editor"), pageId: id, expectedContent: z.string().max(200), document: z.string().max(2_000_000), singleDeleteIds: z.array(id).max(100).optional(), cutTaskIds: z.array(id).max(200).optional(),
    detachDatabaseIds: z.array(id).max(50).optional(), adoptDatabaseBlocks: z.array(z.object({ blockId: id, pageId: id })).max(50).optional(), today: day.optional(), at: at.optional() }),
  z.object({ type: z.literal("ensure-day"), date: day }),
  z.object({ type: z.literal("add-task"), pageId: id, title: title.min(1), plannedOn: day.nullable().optional(), attentionOn: day.nullable().optional(), deadlineOn: day.nullable().optional() }),
  z.object({ type: z.literal("task-status"), taskId: id, status, today: day.optional() }),
  z.object({ type: z.literal("plan-task"), taskId: id, date: day, from: day.optional(), today: day.optional() }),
  z.object({ type: z.literal("plan-tasks"), date: day, items: z.array(z.object({ taskId: id })).min(1).max(100) }),
  z.object({ type: z.literal("not-today"), taskId: id, date: day, onlyThisDay: z.literal(true).optional() }),
  z.object({ type: z.literal("remove-task-row"), pageId: id, taskId: id, today: day }),
  z.object({ type: z.literal("bring-line"), date: day, sourcePageId: id, sourceBlockId: id }),
  z.object({ type: z.literal("handoff-done"), date: day }),
  z.object({ type: z.literal("save-review"), date: day }),
  z.object({ type: z.literal("create-document"), title, body: z.string().max(100_000), pageId: id.optional(), parentId: id.optional() }),
  z.object({ type: z.literal("make-link-pages"), parentPageId: id, items: z.array(z.object({ url: z.string().min(1).max(10_000), pageId: id, title: title.optional() })).min(1).max(50) }),
  z.object({ type: z.literal("apply-link-preview"), pageId: id, url: z.string().min(1).max(10_000), title: z.string().max(2000).nullable(), description: z.string().max(5000).nullable() }),
  z.object({ type: z.literal("rename-page"), pageId: id, title }),
  z.object({ type: z.literal("move-page"), pageId: id, parentId: id.nullable(), beforeId: id.nullable().optional() }),
  z.object({ type: z.literal("delete-page"), pageId: id, at: z.string().max(40) }),
  z.object({ type: z.literal("restore-page"), pageId: id }),
  z.object({ type: z.literal("restore-batch"), trashId: id }),
  z.object({ type: z.literal("create-template"), title: z.string().max(1000), pageId: z.string().min(1).max(200).optional(), dayPage: z.literal(true).optional() }),
  z.object({ type: z.literal("set-template-target"), pageId: z.string().min(1).max(200), target: z.string().min(1).max(200).nullable() }),
  z.object({ type: z.literal("delete-template"), pageId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("set-draft"), pageId: id, status: z.enum(["preparing", "ready", "failed"]), moreOpen: z.array(id).max(200), allowedTaskIds: z.array(id).max(500),
    items: z.array(z.object({ id: z.string().min(1).max(100), anchor: z.string().max(200), place: z.enum(["fill", "after"]), taskId: id.optional(), source: z.enum(["model", "fallback"]), state: z.literal("open"),
      block: z.object({ id: z.string().min(1).max(200), type: z.enum(["paragraph", "bulletListItem", "task"]), props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), content: z.array(z.unknown()).max(50), children: z.array(z.never()).max(0).optional() }).optional() })).max(50) }),
  z.object({ type: z.literal("apply-draft"), pageId: id, itemIds: z.array(z.string().min(1).max(100)).min(1).max(50), edits: z.record(z.string().max(100), z.string().max(500)).optional(), today: day.optional() }),
  z.object({ type: z.literal("skip-draft"), pageId: id, itemIds: z.array(z.string().min(1).max(100)).min(1).max(50) }),
  z.object({ type: z.literal("create-database"), pageId: id, parentId: id.nullable().optional(), homeBlockId: id.nullable(), title }),
  z.object({ type: z.literal("change-database"), pageId: id, change }),
  z.object({ type: z.literal("add-row"), databaseId: id, pageId: id, title, values: values.optional(), beforeId: id.nullable().optional(), copyOf: id.optional(), at }),
  z.object({ type: z.literal("set-values"), ...rowEdit.shape, at }),
  z.object({ type: z.literal("set-values-many"), items: z.array(rowEdit).min(1).max(200), at }),
  z.object({ type: z.literal("delete-pages"), pageIds: z.array(id).min(1).max(200), at }),
  z.object({ type: z.literal("set-timezone"), timezone: z.string().min(1).max(100) }),
  z.object({ type: z.literal("undo"), targetOperationId: id }),
]);
export const commandSchema = z.object({
  operationId: id,
  expectedRevision: z.number().int().nonnegative(),
  action,
});
