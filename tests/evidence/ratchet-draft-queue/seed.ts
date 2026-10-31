import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceRepository } from "../../../src/server/sqlite-repository.ts";
import { harness, dayId, heading, todo } from "../../v2-helpers.ts";
const h = harness();
h.day("2026-10-30");
h.save(dayId("2026-10-30"), () => [
  heading("old", "Yesterday"),
  todo("old-task", "Existing task"),
]);
h.day("2026-10-31");
const repo = new SqliteWorkspaceRepository("/tmp/ratchet-queue.sqlite");
await repo.load();
const db = new DatabaseSync("/tmp/ratchet-queue.sqlite");
db.prepare("update workspace set revision=?,data=? where id=1").run(
  h.ws.revision,
  JSON.stringify(h.ws),
);
db.close();
