import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
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
  let applied = 0;
  await p.route("**/*", (r) => {
    const s = r.request().postData() ?? "";
    if (s.includes("apply-draft")) applied++;
    if (s.includes("save-editor")) return r.abort("failed");
    return r.continue();
  });
  await p.locator(".bn-block-outer[data-id=notes] .bn-inline-content").click();
  await p.keyboard.press("End");
  await p.keyboard.type(" UNSAVED_RETAIN");
  await p.getByRole("button", { name: "Apply all", exact: true }).click();
  await p.waitForTimeout(1000);
  assert.equal(applied, 0);
  assert.ok(
    (await p.locator(".bn-editor").innerText()).includes("UNSAVED_RETAIN"),
  );
  assert.equal(await p.locator("[data-draft-item]").count(), 2);
  console.log(
    "PASS",
    name,
    "failed editor flush blocks Apply and retains typed words + bands",
  );
  await b.close();
}
