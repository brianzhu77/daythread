import { z } from "zod";
const id = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const title = z.string().max(1000);
const status = z.enum(["open", "done", "cancelled"]);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-editor"), pageId: id, expectedContent: z.string().max(200), document: z.string().max(2_000_000), singleDeleteIds: z.array(id).max(100).optional(), cutTaskIds: z.array(id).max(200).optional(), today: day.optional() }),
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
  z.object({ type: z.literal("move-page"), pageId: id, parentId: id.nullable() }),
  z.object({ type: z.literal("delete-page"), pageId: id, at: z.string().max(40) }),
  z.object({ type: z.literal("restore-page"), pageId: id }),
  z.object({ type: z.literal("restore-batch"), trashId: id }),
  z.object({ type: z.literal("create-template"), title: z.string().max(1000), pageId: z.string().min(1).max(200).optional(), dayPage: z.literal(true).optional() }),
  z.object({ type: z.literal("set-template-target"), pageId: z.string().min(1).max(200), target: z.literal("days").nullable() }),
  z.object({ type: z.literal("set-timezone"), timezone: z.string().min(1).max(100) }),
  z.object({ type: z.literal("undo"), targetOperationId: id }),
]);
export const commandSchema = z.object({
  operationId: id,
  expectedRevision: z.number().int().nonnegative(),
  action,
});
