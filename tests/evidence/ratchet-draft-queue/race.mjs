import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
const state = () => {
  const db = new DatabaseSync("/tmp/ratchet-queue.sqlite");
  const ws = JSON.parse(
    db.prepare("select data from workspace where id=1").get().data,
  );
  db.close();
  return ws;
};
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
])
  for (const mode of process.argv.includes("--nav")
    ? ["nav"]
    : ["compute", "commit", "owner"]) {
    execFileSync(process.execPath, [
      "tests/evidence/ratchet-draft-queue/seed.ts",
    ]);
    const b = await engine.launch(),
      p = await b.newPage({
        viewport: { width, height: 900 },
        timezoneId: "America/Vancouver",
        serviceWorkers: "block",
      });
    await p.clock.install({ time: new Date("2026-10-31T22:00:00Z") });
    let release;
    const held = new Promise((r) => (release = r));
    let seen;
    const fetched = new Promise((r) => (seen = r));
    let saves = 0,
      sets = 0;
    const actions = [];
    await p.route("**/_serverFn/**", async (route) => {
      const req = route.request(),
        body = req.postData() ?? "";
      if (req.method() !== "POST") return route.continue();
      if (body.includes("save-editor")) saves++;
      if (body.includes("set-draft")) sets++;
      if (body.includes("action"))
        actions.push(
          body.includes("save-editor")
            ? "save"
            : body.includes("set-draft")
              ? "draft"
              : "other",
        );
      const prepare = body.includes("date") && !body.includes("action");
      const match = mode === "commit" ? body.includes("set-draft") : prepare;
      if (!match) return route.continue();
      const res = await route.fetch();
      seen();
      await held;
      if (mode === "owner") {
        const raw = await res.text();
        // TanStack's response is a Seroval graph: this scalar is the owner field, not ordinary JSON object syntax.
        const changed = raw.replace('"s":"local"', '"s":"different-owner"');
        assert.notEqual(changed, raw, "owner replacement must affect response");
        return route.fulfill({ response: res, body: changed });
      }
      return route.fulfill({ response: res });
    });
    await p.goto("http://127.0.0.1:3687/day/2026-10-31");
    await p.locator(".editor-task-title").first().waitFor();
    await fetched;
    const before = state();
    assert.equal(
      before.pages.some((x) => x.type === "draft"),
      mode === "commit",
    );
    const marker = `Typed ${mode} ${name}`;
    await p
      .locator(".editor-task-title")
      .filter({ hasText: /^$/ })
      .first()
      .click();
    await p.keyboard.type(marker, { delay: 10 });
    await p.waitForTimeout(900);
    if (mode === "commit") {
      assert.equal(
        saves,
        0,
        "save must remain queued while draft commit reply held",
      );
    } else {
      assert.ok(
        state().tasks.some((t) => t.title === marker),
        "typing saves before pure computation reply",
      );
      assert.equal(
        state().pages.some((x) => x.type === "draft"),
        false,
        "server computation must not write",
      );
    }
    if (mode === "nav") {
      await p
        .locator('a[href="/tasks"]:visible')
        .first()
        .click({ noWaitAfter: true });
      console.log("NAV URL", p.url());
      await p.waitForFunction(() => location.pathname === "/tasks");
    }
    release();
    await p.waitForTimeout(1300);
    assert.ok(state().tasks.some((t) => t.title === marker));
    if (mode !== "nav")
      assert.ok(
        !/Couldn't save|changed elsewhere/i.test(
          await p.locator(".editor-save-line").innerText(),
        ),
      );
    if (mode === "owner") {
      assert.equal(sets, 0);
      assert.equal(
        state().pages.some((x) => x.type === "draft"),
        false,
      );
    } else
      assert.ok(
        state().pages.some(
          (x) => x.type === "draft" && x.parentId === "day:2026-10-31",
        ),
      );
    console.log(
      "PASS",
      name,
      mode,
      "typing retained; commands",
      actions.join("→"),
    );
    await b.close();
  }
