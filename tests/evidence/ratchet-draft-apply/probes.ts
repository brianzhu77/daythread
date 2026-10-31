// Existing-command probes: evidence for a proposed draft-apply contract, not tests of a feature that exists.
import assert from "node:assert/strict";
import {
  harness,
  dayId,
  today,
  tomorrow,
  todo,
  under,
  para,
  text,
} from "../../v2-helpers.ts";
import {
  pageContentKey,
  pageNodes,
} from "../../../src/domain/editor-document.ts";
const h = harness();
h.day(today);
h.save(dayId(today), (d) => under(d, "TODO", todo("old-row", "Original task")));
h.day(tomorrow);
const task = h.task("Original task");
const base = pageContentKey(h.page(dayId(tomorrow)));
h.run({ type: "task-status", taskId: task.id, status: "done", today });
assert.equal(pageContentKey(h.page(dayId(tomorrow))), base);
const proposed = structuredClone(pageNodes(h.page(dayId(tomorrow))));
proposed.splice(
  1,
  0,
  todo("llm-row", "Model rewrote this title", "plan", tomorrow),
);
proposed[1].props.taskId = task.id;
h.run({
  type: "save-editor",
  pageId: dayId(tomorrow),
  expectedContent: base,
  document: JSON.stringify(proposed),
  today: tomorrow,
});
assert.equal(
  h.ws.tasks.find((t) => t.id === task.id).title,
  "Model rewrote this title",
);
assert.equal(h.ws.tasks.find((t) => t.id === task.id).status, "done");
console.log(
  "PROVEN: unchanged target expectedContent does not guard a Task changed elsewhere; generic save-editor can rename that existing Task from model text",
);
const j = harness();
j.day(today);
j.save(dayId(today), (d) =>
  under(d, "TODO", todo("task-row", "Keep identity")),
);
j.day(tomorrow);
const existing = j.task("Keep identity");
j.run({
  type: "plan-task",
  taskId: existing.id,
  date: tomorrow,
  today: tomorrow,
});
j.save(dayId(tomorrow), (d) => [...d, para("ai-note", text("Suggested note"))]);
const last = j.ws.undo.operationId;
j.run({ type: "undo", targetOperationId: last });
assert.ok(!j.page(dayId(tomorrow)).document.includes("Suggested note"));
assert.ok(
  pageNodes(j.page(dayId(tomorrow))).some(
    (n) => n.props?.taskId === existing.id,
  ),
);
console.log(
  "PROVEN: plan-task followed by save-editor uses two Undo units; Undo of the save leaves the task carried",
);
const k = harness();
k.day(today);
k.save(dayId(today), (d) => under(d, "TODO", todo("first", "Same words")));
k.day(tomorrow);
k.save(dayId(tomorrow), (d) =>
  under(d, "TODO", todo("llm-new", "Same words", "plan", tomorrow)),
);
assert.equal(k.ws.tasks.length, 2);
console.log(
  "PROVEN: copying existing task words with a new model row identity creates a second Task",
);
const stale = pageContentKey(k.page(dayId(tomorrow)));
k.save(dayId(tomorrow), (d) => [...d, para("manual", text("Manual note"))]);
assert.throws(
  () =>
    k.run({
      type: "save-editor",
      pageId: dayId(tomorrow),
      expectedContent: stale,
      document: "[]",
      today: tomorrow,
    }),
  /changed elsewhere/,
);
console.log(
  "PROVEN: retaining the actual old page key rejects a later page overwrite; replacing it with a fresh key would remove that protection",
);
