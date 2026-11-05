// Comments on a line in the built app (comments.md step 2, P2-4, P2-7): from the chosen block's bar and ⌘⇧M, a mark that shifts nothing, in the margin at 1280 and at the line's end at 390,
// the pane going to the line, a deleted line and its Undo, a move keeping the thread, and a page with none drawing none.
// Usage: node tests/evidence/comments/lines.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S || !width) { console.error('Usage: node tests/evidence/comments/lines.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
const reseed = () => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/comments/seed.ts ${S}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const threads = () => store().threads ?? [], notes = () => store().pages.find(p => p.id === 'notes')
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const send = engine === 'webkit' ? 'Meta+Enter' : 'Control+Enter', mod = engine === 'webkit' ? 'Meta' : 'Control'
const page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const pane = page.locator('.comments-pane'), field = page.getByRole('textbox', { name: 'New comment' }), mark = page.locator('.comment-mark')
const line = page.locator('.bn-inline-content', { hasText: 'A line of notes' }).first()
const openNotes = async () => { await page.goto(`${base}/pages?page=notes`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(1800) }
const geometry = async () => line.evaluate(n => { const b = n.closest('[data-node-type="blockContainer"]').getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(n); const r = t.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, height: b.height } })
const closePane = async () => { if (await pane.count()) { await pane.getByRole('button', { name: 'Close comments' }).click(); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(300) }
const chooseLine = async () => {
  if (wide) { const b = await line.boundingBox(); await page.mouse.move(b.x + 10, b.y + 8); await wait(200); await page.locator('.editor-handle button').first().click(); await wait(350) }
  else { await line.tap(); await wait(400); await page.locator('.editor-touch-handle').first().tap({ force: true }); await wait(400) }
}
const writeOnLine = async words => {
  if (wide) { await line.click(); await wait(200); await page.keyboard.press(`${mod}+Shift+M`); await wait(350); await field.fill(words); await field.press(send); await wait(700) }
  else { await chooseLine(); await page.locator('.editor-selection-bar').getByRole('button', { name: 'Comment' }).tap(); await wait(350); await field.fill(words); await pane.getByRole('button', { name: 'Comment', exact: true }).tap(); await wait(800) }
}

reseed(); await openNotes()
check(await mark.count() === 0, 'a page with none has no marks')
const before = await geometry(), doc0 = notes().document
await writeOnLine('On the line')
{ const t = threads()[0]; check(t?.anchor?.blockId === 'n1' && t.anchor.quote === 'A line of notes' && t.comments[0].body === 'On the line', 'stored on its line, with its words', t?.anchor) }
check(notes().document === doc0, "the page's document is byte for byte what it was")
await closePane(); await wait(300)
check(await mark.count() === 1, 'a mark draws'); await shot('mark')
{ const after = await geometry(); check(Math.abs(after.top - before.top) < 0.5 && Math.abs(after.left - before.left) < 0.5 && Math.abs(after.height - before.height) < 0.5, "it shifts nothing on the line", [before, after]) }
{ const m = await mark.boundingBox(), g = await geometry(), vw = Number(width), editor = await page.locator('.continuous-editor').first().boundingBox()
  check(m.x + m.width <= vw && m.x >= 0 && m.x + m.width <= editor.x + editor.width + 1, 'the mark is on screen and inside the editor', [m.x, m.width, editor.x + editor.width])
  check(m.y + m.height / 2 >= g.top - 2 && m.y + m.height / 2 <= g.top + (wide ? 26 : 30), "and level with the line", [m.y, g.top])
  if (wide) check(m.x >= g.right, 'at 1280, in the margin past the words', [m.x, g.right]); else check(Math.abs(m.x - g.right) <= 8, "at 390, at the line's end", [m.x, g.right]) }
// A page with a mark still scrolls no wider.
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
// The mark opens its thread; the pane's quote goes to the line.
await (wide ? mark.click() : mark.tap()); await wait(350)
check((await pane.locator('.comment-body').allTextContents()).join() === 'On the line' && await pane.locator('button.comment-quote').innerText() === 'A line of notes', 'the mark opens its thread, with its words', await pane.locator('.comment-quote').allInnerTexts())
await shot('pane')
await closePane()
// A reload, then a second thread on the same line: one mark with its count.
await page.reload(); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(1800); check(await mark.count() === 1, 'a reload draws it')
await writeOnLine('Second one'); await closePane(); await wait(300)
check(threads().length === 2 && await mark.count() === 1 && (await mark.getAttribute('aria-label')) === '2 comments on this line', 'two on a line are one mark that says so', await mark.getAttribute('aria-label'))
// Resolving both takes the mark away, and reopening brings it back.
await (wide ? mark.click() : mark.tap()); await wait(300)
for (let i = 0; i < 2; i++) { await pane.getByRole('button', { name: 'Resolve' }).first().click(); await wait(600) }
await closePane(); await wait(300); check(await mark.count() === 0, 'resolved threads leave no mark')
// A line deleted reads as removed, and Undo brings its mark back. At 1280 by its bar; a phone's way to the bar is the same one writing used.
reseed(); await openNotes(); await writeOnLine('Goes with the line'); await closePane(); await wait(300)
await chooseLine(); await (wide ? page.locator('.editor-selection-bar').getByRole('button', { name: 'Delete' }).click() : page.locator('.editor-selection-bar').getByRole('button', { name: 'Delete' }).tap()); await wait(2600)
check(!notes().document.includes('A line of notes') && threads().length === 1, 'a line deleted keeps its thread', threads().length)
check(await mark.count() === 0, 'and no mark')
await clearNotices(); await (wide ? page.locator('.comment-count').first().click() : page.locator('.comment-count').first().tap()); await wait(450); await shot('removed-open')
{ const q = await pane.locator('.comment-quote').first().innerText(); check(q === 'Line removed · A line of notes', 'the pane says so, with its words', q) } await shot('removed'); await closePane()
if (wide) {
  await page.locator('.bn-editor').first().click(); await page.keyboard.press(`${mod}+z`); await wait(2600)
  check(notes().document.includes('A line of notes'), 'Undo brings the line back'); check(await mark.count() === 1, 'and its mark', await mark.count())
  // Moved, the thread and mark follow.
  { const g = await geometry(); await page.mouse.click(g.right + 4, g.top + 10); await wait(150) } await page.keyboard.press('Enter'); await page.keyboard.type('Below it'); await wait(500); await line.click(); await wait(150); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+ArrowDown`); await wait(2600)
  const order = JSON.parse(notes().document).map(n => n.id); check(order.at(-1) === 'n1' || order.indexOf('n1') > 0, 'a move keeps the line', order); const m = await mark.boundingBox(), g = await geometry(); check(Math.abs(m.y + m.height / 2 - (g.top + 12)) < 14, 'and its mark goes with it', [m.y, g.top]); check(threads()[0].anchor.blockId === 'n1', 'on the same anchor')
}
// A To-do line keeps its place.
reseed(); await page.goto(`${base}/`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(1800); check(await mark.count() === 0, 'a day with none has no marks')
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[comments lines ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
