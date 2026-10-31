import assert from "node:assert/strict";
import {
  harness,
  dayId,
  today,
  tomorrow,
  todo,
  heading,
  para,
  text,
  nodesOf,
} from "../../v2-helpers.ts";
import {
  draftOf,
  draftView,
  planningRange,
} from "../../../src/domain/day-draft.ts";
import {
  withFallback,
  buildDayDraftRequest,
  itemsFromModel,
} from "../../../src/server/model/day-draft.ts";
const h = harness();
h.day(today);
h.save(dayId(today), () => [heading("old", "Old"), todo("t", "Carry me")]);
h.day(tomorrow);
const id = h.task("Carry me").id;
const pg = () => h.page(dayId(tomorrow));
h.save(pg().id, () => [
  heading("journal", "Daily Reflection"),
  para("prompt", text("What went well?")),
  todo("reflection-slot", ""),
]);
assert.equal(planningRange(nodesOf(pg())).start, 0);
const req = buildDayDraftRequest(h.ws, pg());
assert.equal(req.blocks.size, 3);
h.run({
  type: "set-draft",
  pageId: pg().id,
  status: "ready",
  allowedTaskIds: [id],
  moreOpen: [],
  items: [
    {
      id: "x",
      anchor: "reflection-slot",
      place: "fill",
      taskId: id,
      source: "model",
      state: "open",
    },
  ],
});
h.run({
  type: "apply-draft",
  pageId: pg().id,
  itemIds: ["x"],
  today: tomorrow,
});
assert.ok(nodesOf(pg()).some((n) => n.props?.taskId === id));
console.log(
  "CONFIRMED reflection-only template: model receives reflection anchors and apply writes under reflection",
);
const j = harness();
j.day(today);
j.save(dayId(today), () => [heading("h", "Todo"), todo("t", "Existing")]);
j.day(tomorrow);
const t = j.task("Existing");
j.save(dayId(tomorrow), () => [para("line", text("Own notes"))]);
const fallback = withFallback(j.ws, j.page(dayId(tomorrow)), [], () =>
  crypto.randomUUID(),
);
j.run({
  type: "set-draft",
  pageId: dayId(tomorrow),
  status: "ready",
  allowedTaskIds: [t.id],
  moreOpen: fallback.moreOpen,
  items: fallback.items,
});
const v = draftView(j.ws, j.page(dayId(tomorrow)));
assert.equal(v.moreOpen.length, 1);
assert.equal(v.planningEndId, null);
console.log(
  "CONFIRMED no-heading page: moreOpen exists but planningEndId is null; UI bandGroups requires truthy end and omits its host",
);
const k = harness();
k.day(today);
k.save(dayId(today), () => [heading("h", "Todo"), todo("t", "Existing")]);
k.day(tomorrow);
const tid = k.task("Existing").id;
const p = k.page(dayId(tomorrow));
const anchor = nodesOf(p).find((n) => n.type === "task").id;
const set = (itemid) =>
  k.run({
    type: "set-draft",
    pageId: p.id,
    status: "ready",
    allowedTaskIds: [tid],
    moreOpen: [],
    items: [
      {
        id: itemid,
        anchor,
        place: "after",
        block: {
          id: "proposed",
          type: "paragraph",
          props: {},
          content: [text("Proposed line")],
          children: [],
        },
        source: "model",
        state: "open",
      },
    ],
  });
set("generation1");
k.run({ type: "skip-draft", pageId: p.id, itemIds: ["generation1"] });
assert.throws(() => set("generation2"), /already has its draft/);
assert.equal(draftView(k.ws, k.page(p.id)).items.length, 0);
console.log(
  "PASS first ready draft rejects later generation and preserves the skipped new line disposition",
);
const stale = harness();
stale.day(today);
stale.save(dayId(today), () => [
  heading("old", "Yesterday"),
  todo("task", "Carry"),
]);
stale.day(tomorrow);
const sid = stale.task("Carry").id;
const target = stale.page(dayId(tomorrow));
stale.save(target.id, () => [
  heading("p", "Planning"),
  todo("first", ""),
  heading("r", "Reflection"),
  para("gone"),
]);
const proposal = [
  {
    id: "stale",
    anchor: "first",
    place: "fill",
    taskId: sid,
    source: "model",
    state: "open",
  },
];
const combined = withFallback(stale.ws, stale.page(target.id), proposal, () =>
  crypto.randomUUID(),
);
stale.save(target.id, () => [
  heading("p", "Planning"),
  todo("other", ""),
  heading("r", "Reflection"),
  todo("first", ""),
]);
stale.run({
  type: "set-draft",
  pageId: target.id,
  status: "ready",
  allowedTaskIds: [sid],
  moreOpen: combined.moreOpen,
  items: combined.items,
});
const sv = draftView(stale.ws, stale.page(target.id));
assert.equal(sv.items.length, 1);
assert.equal(sv.moreOpen.length, 0);
console.log(
  "PASS moved outside anchor retains the Task as a safely relocated band",
);
