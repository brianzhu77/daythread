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
      ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
    });
  await p.clock.install({ time: new Date("2026-10-31T18:00:00Z") });
  await p.goto("http://127.0.0.1:3687/day/2026-10-31");
  const carry = p.locator("[data-draft-item=carry] .draft-text"),
    fresh = p.locator("[data-draft-item=new] .draft-text");
  await carry.waitFor();
  const own = () =>
    p.locator(".bn-editor .bn-inline-content").allTextContents();
  const before = await own();
  assert.equal(await carry.evaluate((e) => e.isContentEditable), false);
  assert.equal(
    await carry.evaluate((e) => getComputedStyle(e).cursor),
    "default",
  );
  await carry.click();
  await p.keyboard.type(" NOT_ACCEPTED");
  assert.equal(await carry.textContent(), "Existing carry");
  assert.equal(
    await carry.evaluate((e) => getComputedStyle(e).boxShadow),
    "none",
  );
  assert.deepEqual(await own(), before);
  console.log(
    "PASS",
    name,
    "real carried Task read-only/default cursor/no focus line; tapping+typing changes neither band nor page",
  );
  assert.equal(await fresh.evaluate((e) => e.isContentEditable), true);
  await fresh.click();
  await p.keyboard.press("Meta+ArrowRight");
  await p.keyboard.type(" suffix");
  await p.keyboard.press("Meta+ArrowLeft");
  await p.keyboard.type("prefix ");
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  await p.keyboard.press("Home");
  await p.keyboard.type("?");
  const edited = await fresh.textContent();
  console.log("EDITED", name, JSON.stringify(edited));
  assert.ok(
    ["Original suggestion", "prefix", "suffix"].every((s) =>
      edited.includes(s),
    ),
  );
  assert.ok(edited.includes("!") && edited.includes("?"));
  assert.deepEqual(await own(), before);
  console.log(
    "PASS",
    name,
    "Meta left/right + End/Home keep edits inside proposal; own document untouched",
  );
  await p.getByRole("button", { name: "Apply all", exact: true }).click();
  await p.waitForTimeout(900);
  const titles = await p.locator(".editor-task-title").allTextContents();
  assert.ok(titles.includes(edited));
  assert.ok(titles.includes("Existing carry"));
  await p.reload();
  await p.locator(".bn-editor").waitFor();
  const restored = await p.locator(".editor-task-title").allTextContents();
  assert.ok(restored.includes(edited));
  assert.ok(restored.includes("Existing carry"));
  console.log(
    "PASS",
    name,
    "real Apply all + reload keeps edited new task and unchanged same carried Task",
  );
  await b.close();
}
