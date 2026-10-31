import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  execFileSync(process.execPath, ["tests/evidence/ratchet-day-draft/seed.ts"]);
  const b = await engine.launch(),
    p = await b.newPage({
      viewport: { width, height: 900 },
      timezoneId: "America/Vancouver",
      serviceWorkers: "block",
    });
  await p.clock.install({ time: new Date("2026-10-31T18:00:00Z") });
  await p.goto("http://127.0.0.1:3687/day/2026-10-31");
  await p
    .locator("[data-draft-item=carry] .draft-text")
    .fill("My renamed carry");
  await p
    .getByRole("button", { name: "Apply Existing carry", exact: true })
    .click();
  await p.waitForTimeout(900);
  const words = await p.locator(".editor-task-title").allTextContents();
  assert.ok(words.includes("Existing carry"));
  assert.ok(!words.includes("My renamed carry"));
  console.log(
    "CONFIRMED",
    name,
    "editable carried band silently drops its explicit title edit on per-item Apply",
  );
  await b.close();
}
