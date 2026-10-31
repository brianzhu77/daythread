import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
const base = "http://127.0.0.1:3687";
for (const [name, engine, width] of [
  ["chromium", chromium, 1280],
  ["webkit", webkit, 390],
]) {
  execFileSync(process.execPath, ["tests/evidence/ratchet-resend/seed.ts"]);
  const b = await engine.launch();
  const device = async () => {
    const c = await b.newContext({
      viewport: { width, height: 900 },
      timezoneId: "America/Vancouver",
      serviceWorkers: "block",
    });
    const p = await c.newPage();
    p.setDefaultTimeout(12000);
    return p;
  };
  const a = await device(),
    other = await device();
  const open = async (p, path = "/") => {
    await p.goto(base + path);
    await p.locator(".bn-editor").waitFor();
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(400);
  };
  const line = () => a.locator(".editor-save-line");
  const saved = async () => {
    await a.waitForFunction(
      () =>
        document.querySelector(".editor-save-line")?.textContent === "Saved",
    );
  };
  const append = async (p, words) => {
    await p.locator(".editor-task-title").first().click();
    await p.keyboard.press("Meta+ArrowRight");
    await p.waitForTimeout(180);
    await p.keyboard.type(words, { delay: 10 });
  };
  await open(a);
  const sent = [];
  await a.route("**/_serverFn/**", (r) => {
    const s = r.request().postData() ?? "";
    if (s.includes("save-editor")) sent.push(s);
    return r.continue();
  });
  await a.evaluate(() => {
    window.badSaveStates = [];
    new MutationObserver(() => {
      const t = document.querySelector(".editor-save-line")?.textContent ?? "";
      if (/Couldn't|elsewhere|changed/i.test(t)) window.badSaveStates.push(t);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await open(other, "/day/2026-10-20");
  await a
    .locator(".editor-task-title")
    .filter({ hasText: /^$/ })
    .first()
    .click();
  await a.keyboard.type("Kept first", { delay: 10 });
  await saved();
  assert.equal(sent.length, 2);
  assert.equal(
    sent[0].match(/operationId[^,}]*/)[0],
    sent[1].match(/operationId[^,}]*/)[0],
  );
  assert.deepEqual(await a.evaluate(() => window.badSaveStates), []);
  console.log(
    "PASS",
    name,
    "new day elsewhere: exactly one silent retry, same identity",
  );
  let before = sent.length;
  await open(other, "/day/2026-10-21");
  await append(a, " second");
  await saved();
  assert.equal(sent.length - before, 2);
  await a.reload();
  await a.locator(".editor-task-title").first().waitFor();
  assert.ok(
    (await a.locator(".editor-task-title").first().textContent()).includes(
      "Kept first second",
    ),
  );
  console.log(
    "PASS",
    name,
    "other page revision: one retry and words persist after reload",
  );
  await open(other, "/");
  await append(other, " OTHER");
  await other.waitForFunction(
    () => document.querySelector(".editor-save-line")?.textContent === "Saved",
  );
  before = sent.length;
  await append(a, " MINE");
  await a.waitForTimeout(1500);
  assert.notEqual(await line().textContent(), "Saved");
  assert.equal(sent.length - before, 1);
  assert.ok((await a.locator(".bn-editor").innerText()).includes("MINE"));
  console.log(
    "PASS",
    name,
    "same-page conflict: no resend, local words retained",
  );
  await b.close();
  // Fresh store: move the revision a second time just before the retry reaches the server.
  execFileSync(process.execPath, ["tests/evidence/ratchet-resend/seed.ts"]);
  const bb = await engine.launch();
  const c1 = await bb.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: "block",
    }),
    c2 = await bb.newContext({ serviceWorkers: "block" }),
    p = await c1.newPage(),
    q = await c2.newPage();
  await open(p);
  await open(q, "/day/2026-10-22");
  let count = 0;
  await p.route("**/_serverFn/**", async (r) => {
    if ((r.request().postData() ?? "").includes("save-editor")) {
      count++;
      if (count === 2) await open(q, "/day/2026-10-23");
    }
    return r.continue();
  });
  await p
    .locator(".editor-task-title")
    .filter({ hasText: /^$/ })
    .first()
    .click();
  await p.keyboard.type("Bounded retry");
  await p.waitForTimeout(2200);
  assert.equal(count, 2);
  assert.match(
    await p.locator(".editor-save-line").innerText(),
    /Couldn't|elsewhere|changed/,
  );
  await p.getByRole("button", { name: "Retry saving", exact: true }).click();
  await p.waitForTimeout(900);
  assert.equal(count, 3);
  assert.equal(await p.locator(".editor-save-line").textContent(), "Saved");
  console.log(
    "PASS",
    name,
    "second refusal stops automatic attempts; manual Retry succeeds",
  );
  await bb.close();
}
