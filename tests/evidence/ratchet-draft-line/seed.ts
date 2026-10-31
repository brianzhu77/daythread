import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceRepository } from "../../../src/server/sqlite-repository.ts";
import {
  harness,
  dayId,
  todo,
  heading,
  para,
  text,
  nodesOf,
} from "../../v2-helpers.ts";
const bare = process.argv.includes("--bare");
const h = harness();
h.day("2026-10-30");
h.save(dayId("2026-10-30"), () => [
  heading("old", "Yesterday"),
  todo("old-task", "Existing carry"),
  todo("extra-task", "Extra task"),
]);
h.day("2026-10-31");
const p = h.page(dayId("2026-10-31"));
h.save(p.id, () =>
  bare
    ? [para("notes", text("No heading note"))]
    : [
        heading("planning", "Planning"),
        todo("slot", ""),
        para("notes", text("Own note")),
        para("drop", text("Intentional Drop / Slack")),
        para("drop-line", text("- ")),
        { id: "divider", type: "divider", props: {}, children: [] },
        heading("reflection", "Raw Notes"),
        para("end", text("Private words")),
      ],
);
h.run({
  type: "set-draft",
  pageId: p.id,
  status: "ready",
  allowedTaskIds: h.ws.tasks.map((t) => t.id),
  moreOpen: [h.ws.tasks[1].id],
  items: [
    {id: "bullet", anchor:"notes",place:"after",block:{id:"bp",type:"bulletListItem",props:{},content:[text("10:30 Dentist")],children:[]},source:"model",state:"open"},
    {id: "line", anchor:"drop-line",place:"after",block:{id:"lp",type:"paragraph",props:{},content:[text("Proposed line")],children:[]},source:"model",state:"open"},
    {
      id: "new",
      anchor: bare ? "" : "slot",
      place: bare ? "after" : "fill",
      block: {
        id: "proposed",
        type: "task",
        props: {},
        content: [text("Original suggestion")],
        children: [],
      },
      source: "model",
      state: "open",
    },
    ...(!bare
      ? [
          {
            id: "carry",
            anchor: "slot",
            place: "after",
            taskId: h.ws.tasks[0].id,
            source: "model",
            state: "open",
          },
        ]
      : []),
  ],
});
const repo = new SqliteWorkspaceRepository("/tmp/ratchet254.sqlite");
await repo.load();
const db = new DatabaseSync("/tmp/ratchet254.sqlite");
db.prepare("update workspace set revision=?,data=? where id=1").run(
  h.ws.revision,
  JSON.stringify(h.ws),
);
db.close();
console.log("Seeded local synthetic real-hook draft");
