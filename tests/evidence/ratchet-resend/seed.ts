import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceRepository } from "../../../src/server/sqlite-repository.ts";
import { createEmptyWorkspace } from "../../../src/domain/workspace.ts";
const repo = new SqliteWorkspaceRepository("/tmp/ratchet-resend.sqlite");
await repo.load();
const db = new DatabaseSync("/tmp/ratchet-resend.sqlite");
db.prepare("update workspace set revision=?,data=? where id=1").run(
  0,
  JSON.stringify(createEmptyWorkspace()),
);
db.close();
