// Task aliases and dates faithfully transcribed from the real five-run attachment; journal/title text omitted.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  harness,
  dayId,
  heading,
  todo,
  bullet,
  para,
  text,
} from "../../v2-helpers.ts";
import {
  withFallback,
  itemsFromModel,
} from "../../../src/server/model/day-draft.ts";
import { draftView } from "../../../src/domain/day-draft.ts";
const cases = JSON.parse(
  fs.readFileSync(new URL("./captured-coverage.json", import.meta.url), "utf8"),
);
for (const c of cases) {
  const h = harness();
  h.day(c.date);
  h.save(dayId(c.date), () => [
    heading("T1", "Planning"),
    { ...heading("T2", "Events"), props: { level: 3 } },
    bullet("T3"),
    { ...heading("T4", "Top"), props: { level: 3 } },
    para("T5", text("Prompt")),
    todo("T6", ""),
    todo("T7", ""),
    todo("T8", ""),
    { ...heading("T9", "Other"), props: { level: 3 } },
    para("T10"),
    todo("T11", ""),
    heading("R", "Reflection"),
  ]);
  for (const t of c.tasks) {
    h.day(t.planned);
    h.run({
      type: "add-task",
      pageId: dayId(t.planned),
      title: t.id,
      plannedOn: t.planned,
    });
    t.real = h.task(t.id).id;
  }
  const yesterday = new Date(Date.parse(c.date + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  h.day(yesterday);
  h.save(dayId(yesterday), (d) => [
    ...d,
    ...c.tasks
      .filter(
        (t) => t.yesterdayOpen && !d.some((n) => n.props?.taskId === t.real),
      )
      .map((t) => ({
        ...todo("ref-" + t.id, t.id, "reference", ""),
        props: { taskId: t.real, role: "reference", planDate: "" },
      })),
  ]);
  const page = h.page(dayId(c.date));
  const req = {
    blocks: new Map(JSON.parse(h.page(page.id).document).map((n) => [n.id, n])),
    lines: new Map(),
    tasks: new Map(
      c.tasks.map((t) => [t.id, h.ws.tasks.find((x) => x.id === t.real)]),
    ),
    messages: [],
  };
  const raw = itemsFromModel(
    req,
    c.suggestions.map((s) => ({
      anchor: s.slot,
      place: "fill",
      kind: "existing_todo",
      taskId: s.task,
      lineId: "",
      text: "",
      why: "",
    })),
    () => crypto.randomUUID(),
  );
  const f = withFallback(h.ws, h.page(page.id), raw, () => crypto.randomUUID());
  h.run({
    type: "set-draft",
    pageId: page.id,
    status: "ready",
    items: f.items,
    moreOpen: f.moreOpen,
    allowedTaskIds: c.tasks.map((t) => t.real),
  });
  const v = draftView(h.ws, h.page(page.id));
  const placed = new Set(v.items.map((i) => i.taskId)),
    more = new Set(v.moreOpen.map((t) => t.taskId));
  const onPage = new Set<string>();
  for (const n of JSON.parse(h.page(page.id).document))
    if (n.props?.taskId) onPage.add(n.props.taskId);
  for (const t of c.tasks) {
    if (t.yesterdayOpen || t.planned <= c.date)
      assert.ok(placed.has(t.real) || more.has(t.real) || onPage.has(t.real));
    if (t.planned === c.date)
      assert.ok(placed.has(t.real) || onPage.has(t.real));
    assert.ok(!(placed.has(t.real) && more.has(t.real)));
  }
  console.log(
    "PASS actual captured task choices",
    c.date,
    "raw",
    raw.length,
    "normalized bands",
    v.items.length,
    "other-open",
    v.moreOpen.length,
  );
}
