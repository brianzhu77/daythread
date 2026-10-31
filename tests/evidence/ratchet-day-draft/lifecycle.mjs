import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium, webkit } from "@playwright/test";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  execFileSync(process.execPath, ["tests/evidence/ratchet-day-draft/seed.ts"]);
  const b = await engine.launch();
  const p = await b.newPage({
    viewport: { width, height: 900 },
    timezoneId: "America/Vancouver",
    serviceWorkers: "block",
  });
  await p.clock.install({ time: new Date("2026-10-31T18:00:00Z") });
  await p.goto("http://127.0.0.1:3687/day/2026-10-31");
  await p.locator("[data-draft-item=new]").waitFor();
  const line = p.locator(".bn-block-outer[data-id=notes] .bn-inline-content");
  await line.click();
  await p.keyboard.press("End");
  await p.keyboard.type(" KEEP_TYPED");
  await p.getByRole("button", { name: "Apply all", exact: true }).click();
  await p.waitForTimeout(1400);
  assert.ok((await p.locator(".bn-editor").innerText()).includes("KEEP_TYPED"));
  await p.getByRole("button", { name: "Undo", exact: true }).last().click();
  await p.waitForTimeout(900);
  if (await p.getByRole("button", { name: "Show", exact: true }).count())
    await p.getByRole("button", { name: "Show", exact: true }).click();
  await p.waitForTimeout(300);
  const restoredTitles = await p
    .locator(".editor-task-title")
    .allTextContents();
  console.log("UNDO EDITOR TITLES", name, JSON.stringify(restoredTitles));
  assert.ok(
    !restoredTitles.includes("Original suggestion") &&
      !restoredTitles.includes("Existing carry"),
    "Undo must remove applied editor rows as well as restore bands",
  );
  assert.ok((await p.locator(".bn-editor").innerText()).includes("KEEP_TYPED"));
  console.log(
    "PASS",
    name,
    "one Undo restores both bands, preserves pre-Apply typing",
  );
  await p.reload();
  await p.locator("[data-draft-item=new]").waitFor();
  assert.ok((await p.locator(".bn-editor").innerText()).includes("KEEP_TYPED"));
  console.log("PASS", name, "typed words and restored bands survive reload");
  let cut = true;
  const ids = [];
  await p.route("**/*", async (r) => {
    const body = r.request().postData() ?? "";
    if (body.includes("apply-draft")) {
      ids.push(body.match(/operationId[^,}]*/)?.[0] ?? body);
      if (cut) {
        cut = false;
        await r.fetch();
        return r.fulfill({ status: 503, body: "temporary" });
      }
    }
    return r.continue();
  });
  await p
    .getByRole("button", { name: "Apply Original suggestion", exact: true })
    .click();
  await p.waitForTimeout(900);
  const retry = p.getByRole("button", { name: "Retry", exact: true });
  if (await retry.count()) await retry.click();
  await p.waitForTimeout(1200);
  assert.ok(ids.length >= 2, "uncertain commit should be replayed");
  assert.equal(ids[0], ids[1], "same operation id on retry");
  assert.equal(
    (await p.locator(".editor-task-title").allTextContents()).filter(
      (t) => t === "Original suggestion",
    ).length,
    1,
  );
  console.log(
    "PASS",
    name,
    "uncertain-commit Retry uses same operation and leaves one new Task row",
  );
  await b.close();
}
