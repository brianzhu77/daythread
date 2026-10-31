import { SqliteWorkspaceRepository } from "../../../src/server/sqlite-repository.ts";
import {
  pageNodes,
  pageContentKey,
  textRun,
} from "../../../src/domain/editor-document.ts";
const repo = new SqliteWorkspaceRepository("/tmp/ratchet248.sqlite");
let ws = await repo.load();
async function run(action) {
  ws = (
    await repo.execute({
      operationId: crypto.randomUUID(),
      expectedRevision: ws.revision,
      action,
    })
  ).workspace;
}
await run({ type: "ensure-day", date: "2026-10-30" });
const page = ws.pages.find((p) => p.id === "day:2026-10-30");
await run({
  type: "save-editor",
  pageId: page.id,
  expectedContent: pageContentKey(page),
  document: JSON.stringify([
    ...pageNodes(page),
    {
      id: "plain-dot",
      type: "paragraph",
      content: [textRun("Plain day fixture")],
      props: {},
      children: [],
    },
  ]),
  today: "2026-10-31",
});
console.log("Added invented prior-day dot for picker coverage");
