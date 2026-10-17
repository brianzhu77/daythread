import { z } from "zod";
const id = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const title = z.string().max(1000);
const body = z.string().max(100_000);
const status = z.enum(["open", "done", "cancelled"]);
const outcome = z.enum(["success", "failure", "budget", "context"]).optional();
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-editor"), pageId: id, expectedContent: z.string().max(2_000_000), document: z.string().max(1_000_000), singleDeleteIds: z.array(id).max(100).optional(), today: day.optional() }),
  z.object({ type: z.literal("ensure-day"), date: day }),
  z.object({
    type: z.literal("rename-section"),
    pageId: id,
    sectionId: id,
    title,
  }),
  z.object({ type: z.literal("add-section"), pageId: id, title }),
  z.object({ type: z.literal("remove-section"), pageId: id, sectionId: id }),
  z.object({
    type: z.literal("add-text"),
    pageId: id,
    sectionId: id,
    text: body,
  }),
  z.object({
    type: z.literal("edit-block"),
    pageId: id,
    blockId: id,
    text: body,
  }),
  z.object({
    type: z.literal("remove-blocks"),
    pageId: id,
    blockIds: z.array(id).min(1).max(1000),
    bulk: z.boolean(),
    today: day,
  }),
  z.object({
    type: z.literal("add-task"),
    pageId: id,
    sectionId: id,
    title: title.min(1),
    plannedOn: day.nullable().optional(),
    attentionOn: day.nullable().optional(),
    deadlineOn: day.nullable().optional(),
  }),
  z.object({ type: z.literal("task-status"), taskId: id, status }),
  z.object({
    type: z.literal("plan-task"),
    taskId: id,
    date: day,
    section: z.enum(["top3", "other"]).optional(),
  }),
  z.object({ type: z.literal("not-today"), taskId: id, date: day }),
  z.object({
    type: z.literal("add-event"),
    pageId: id,
    title: title.min(1),
    date: day,
    time: z.string().max(5).nullable().optional(),
  }),
  z.object({
    type: z.literal("keep-block"),
    sourcePageId: id,
    blockId: id,
    targetDate: day,
  }),
  z.object({ type: z.literal("handoff-done"), date: day }),
  z.object({
    type: z.literal("save-review"),
    date: day,
    text: body,
    finish: z.boolean(),
  }),
  z.object({
    type: z.literal("save-material"),
    pageId: id,
    sectionId: id,
    url: z.string().max(10_000),
    title,
    body: body.optional(),
    note: body.optional(),
  }),
  z.object({
    type: z.literal("review-material"),
    materialId: id,
    decision: z.enum(["watching", "lower", "done", "task"]),
    date: day,
    nextReviewOn: day.optional(),
  }),
  z.object({
    type: z.literal("material-resurface"),
    materialId: id,
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("skip-material-review"),
    materialIds: z.array(id).max(3),
    date: day,
  }),
  z.object({ type: z.literal("open-material"), materialId: id, date: day }),
  z.object({ type: z.literal("dismiss-material"), materialId: id, date: day }),
  z.object({
    type: z.literal("review-progress"),
    date: day,
    step: z.number().int().min(0).max(10),
    source: z.enum(["reminder", "direct"]).optional(),
    skip: z.boolean().optional(),
  }),
  z.object({ type: z.literal("create-document"), title, body }),
  z.object({
    type: z.literal("insert-reference"),
    pageId: id,
    sectionId: id,
    targetPageId: id,
  }),
  z.object({
    type: z.literal("capture"),
    pageId: id,
    text: body.min(1),
    outcome,
    updateTaskId: id.optional(),
  }),
  z.object({
    type: z.literal("edit-capture"),
    captureId: id,
    title,
    proposalRevision: z.number().int().min(1),
    removeItemId: id.optional(),
  }),
  z.object({
    type: z.literal("apply-capture"),
    captureId: id,
    proposalRevision: z.number().int().min(1),
  }),
  z.object({ type: z.literal("discard-capture"), captureId: id }),
  z.object({ type: z.literal("generate-draft"), date: day, outcome }),
  z.object({ type: z.literal("save-draft"), date: day, taskIds: z.array(id).max(3), materialIds: z.array(id).max(2) }),
  z.object({ type: z.literal("undo"), targetOperationId: id }),
  z.object({
    type: z.literal("keep-planned"),
    targetOperationId: id,
    pageId: id,
    blockId: id,
  }),
]);
export const commandSchema = z.object({
  operationId: id,
  expectedRevision: z.number().int().nonnegative(),
  action,
});
