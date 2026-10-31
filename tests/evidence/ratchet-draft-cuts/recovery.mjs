import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  const b = await engine.launch(),
    ctx = await b.newContext({
      viewport: { width, height: 900 },
      timezoneId: "America/Vancouver",
      serviceWorkers: "block",
    }),
    p = await ctx.newPage();
  await p.goto("http://127.0.0.1:3688/");
  await p.locator(".bn-editor").waitFor();
  await p.waitForLoadState("networkidle");
  const marker = "Recovery " + name + " " + Date.now();
  const op = crypto.randomUUID();
  await p.evaluate(
    ({ marker, op }) => {
      localStorage.setItem(
        "daythread.tomorrow-lines.local",
        JSON.stringify([
          {
            key: op,
            title: marker,
            operationId: op,
            failed: true,
            date: "2026-10-30",
            typedOn: "2026-10-29",
          },
        ]),
      );
      localStorage.setItem(
        "daythread.tomorrow-lines.another-owner",
        JSON.stringify([
          {
            key: "foreign",
            title: "OTHER OWNER PRIVATE",
            operationId: "foreign",
            failed: true,
            date: "2026-10-30",
            typedOn: "2026-10-29",
          },
        ]),
      );
    },
    { marker, op },
  );
  let fail = true;
  const bodies = [];
  await p.route("**/*", async (r) => {
    const s = r.request().postData() ?? "";
    if (s.includes("add-task") && s.includes(marker)) {
      bodies.push(s);
      if (fail) {
        fail = false;
        await r.fetch();
        return r.fulfill({ status: 503, body: "lost reply" });
      }
    }
    return r.continue();
  });
  await p.reload();
  await p.locator(".bn-editor").waitFor();
  await p.waitForTimeout(900);
  const kept = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("daythread.tomorrow-lines.local")),
  );
  assert.equal(kept.length, 1, "lost reply retains pending line");
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForTimeout(1500);
  assert.equal(await p.locator(".editor-task", { hasText: marker }).count(), 1);
  assert.equal(
    await p.evaluate(() =>
      localStorage.getItem("daythread.tomorrow-lines.local"),
    ),
    "[]",
  );
  assert.ok(
    await p.evaluate(() =>
      localStorage
        .getItem("daythread.tomorrow-lines.another-owner")
        .includes("OTHER OWNER PRIVATE"),
    ),
  );
  assert.ok(bodies.length >= 2);
  assert.ok(bodies.every((s) => s.includes(op)));
  await p.reload();
  await p.waitForLoadState("networkidle");
  assert.equal(await p.locator(".editor-task", { hasText: marker }).count(), 1);
  console.log(
    "PASS",
    name,
    "lost add reply kept + same-id reconnect retry + one Task after reload + other owner untouched",
  );
  await b.close();
}
