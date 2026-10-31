import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  const b = await engine.launch();
  const p = await b.newPage({
    viewport: { width, height: 900 },
    timezoneId: "America/Vancouver",
    serviceWorkers: "block",
    ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
  });
  await p.clock.install({ time: new Date("2026-10-31T18:00:00Z") });
  await p.goto("http://127.0.0.1:3687/day/2026-10-31");
  await p.locator("[data-draft-item=new]").waitFor();
  const band = p.locator("[data-draft-item=new] .draft-text");
  await band.fill("My edited suggestion");
  await p.getByRole("button", { name: "Apply all", exact: true }).click();
  await p.waitForTimeout(1500);
  const words = await p.locator(".editor-task-title").allTextContents();
  assert.ok(words.includes("My edited suggestion"));
  assert.ok(!words.includes("Original suggestion"));
  console.log(
    "PASS",
    name,
    width,
    "Apply all preserves visible band edit:",
    JSON.stringify(words),
  );
  await p.getByRole("button", { name: "Undo", exact: true }).last().click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/ratchet249-${name}.png` });
  await b.close();
}
