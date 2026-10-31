import assert from "node:assert/strict";
import {
  dayRowInsertIndex,
  flatNodes,
  isTaskRow,
} from "../../../src/domain/editor-document.ts";
import { heading, todo, para, text } from "../../v2-helpers.ts";
const oldIndex = (doc, tasks) => {
  const first = doc.findIndex((n) => flatNodes([n]).some(isTaskRow));
  let h = first;
  if (first < 0) h = doc.findIndex((n) => n.type === "heading");
  else while (h >= 0 && doc[h].type !== "heading") h--;
  let end = h + 1;
  while (
    end < doc.length &&
    isTaskRow(doc[end]) &&
    tasks.has(String(doc[end].props.taskId))
  )
    end++;
  return end;
};
const h = (id, level) => ({ ...heading(id, id), props: { level } });
for (const doc of [
  [h("TODO", 2), todo("slot", ""), h("Events", 2), para("note", text("note"))],
  [
    h("Start", 2),
    para("label", text("My label")),
    todo("slot", ""),
    h("End", 2),
  ],
  [para("label", text("No heading")), todo("slot", "")],
  [h("Empty", 2), para("line", text("No task"))],
])
  assert.equal(dayRowInsertIndex(doc, new Set()), oldIndex(doc, new Set()));
assert.equal(
  dayRowInsertIndex(
    [
      h("root", 2),
      h("previous", 3),
      h("top", 3),
      todo("slot", ""),
      h("later", 1),
    ],
    new Set(),
  ),
  1,
);
assert.equal(
  dayRowInsertIndex(
    [
      h("root", 1),
      h("old", 2),
      h("new-root", 1),
      h("child", 3),
      todo("slot", ""),
    ],
    new Set(),
  ),
  3,
);
assert.equal(
  dayRowInsertIndex(
    [
      h("root", 2),
      {
        ...todo("carried", "Carried", "plan", "2026-11-01"),
        props: { taskId: "carried" },
      },
      h("child", 3),
      todo("slot", ""),
    ],
    new Set(["carried"]),
  ),
  2,
);
console.log(
  "PASS: built-in/flat/no-heading/no-task old-new indexes equal; nested/later-h1/section boundary/group append correct",
);
