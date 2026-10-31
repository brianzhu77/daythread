import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  execFileSync(process.execPath, [
    "tests/evidence/ratchet-day-draft/seed.ts",
    "--bare",
  ]);
  const b = await engine.launch();
  const p = await b.newPage({
    viewport: { width, height: 900 },
    timezoneId: "America/Vancouver",
    serviceWorkers: "block",
  });
  await p.clock.install({ time: new Date("2026-10-31T18:00:00Z") });
  await p.goto("http://127.0.0.1:3687/day/2026-10-31");
  await p.locator("[data-draft-item=new]").waitFor();
  await p.getByRole("button", { name: /1 more open/ }).click();
  assert.ok(
    await p
      .locator(".draft-more")
      .getByRole("button", { name: "Add Existing carry to today" })
      .isVisible(),
  );
  await p.getByRole("button", { name: "Apply all", exact: true }).click();
  await p.waitForTimeout(900);
  assert.ok(
    (await p.locator(".editor-task-title").allTextContents()).includes(
      "Original suggestion",
    ),
  );
  console.log(
    "PASS",
    name,
    width,
    "top-of-document band + moreOpen host visible and Apply works",
  );
  await b.close();
}
