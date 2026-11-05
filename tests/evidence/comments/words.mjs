// Comments on selected words in the built app (comments.md step 3, P2-5): from ⌘⇧M at 1280 and the toolbar at 390, an underline under those words and not the same words elsewhere, the document untouched, and when the line's edited the mark stays with the quote kept.
// Usage: node tests/evidence/comments/words.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S || !width) { console.error('Usage: node tests/evidence/comments/words.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/comments/seed.ts ${S}`, { stdio: 'ignore' })
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
const pane = page.locator('.comments-pane'), field = page.getByRole('textbox', { name: 'New comment' }), under = page.locator('.comment-underline'), mark = page.locator('.comment-mark')
const line = page.locator('.bn-inline-content', { hasText: 'A line of notes' }).first()
const toEnd = async () => { const g = await line.evaluate(n => { const t = document.createRange(); t.selectNodeContents(n); const b = t.getBoundingClientRect(); return { x: b.right, y: b.top + b.height / 2 } }); if (wide) await page.mouse.click(g.x + 4, g.y); else await page.touchscreen.tap(g.x + 4, g.y); await wait(250) }
await page.goto(`${base}/pages?page=notes`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(1800)
await toEnd(); await page.keyboard.type(' and notes again'); await wait(2600)
const words = 'A line of notes and notes again'; check(JSON.stringify(notes().document).includes(words.replace(/"/g, '')), 'the line says it twice')
const doc0 = notes().document
// The second "notes".
const at = words.lastIndexOf('notes')
await line.evaluate((n, at) => { const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); const text = walker.nextNode(); const r = document.createRange(); r.setStart(text, at); r.setEnd(text, at + 5); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }, at); await wait(450)
if (wide) { await page.keyboard.press(`${mod}+Shift+M`); await wait(400); await shot('composing'); await field.fill('On the second'); await field.press(send); await wait(900) }
else { await page.getByRole('button', { name: 'Comment', exact: true }).first().tap(); await wait(450); await field.fill('On the second'); await pane.getByRole('button', { name: 'Comment', exact: true }).tap(); await wait(1000) }
{ const t = threads()[0]; check(t?.anchor?.quote === 'notes' && t.anchor.at === at, 'stored with its words and their place', t?.anchor) }
check(notes().document === doc0, "the page's document is byte for byte what it was")
await pane.getByRole('button', { name: 'Close comments' }).click(); await wait(400)
check(await under.count() === 1 && (await under.innerText()) === 'notes', 'those words are underlined', await under.allInnerTexts()); await shot('underlined')
// It's the second one, not the first.
{ const u = await under.boundingBox(), first = await line.evaluate(n => { const text = document.createTreeWalker(n, NodeFilter.SHOW_TEXT).nextNode(), r = document.createRange(); r.setStart(text, 10); r.setEnd(text, 15); return r.getBoundingClientRect().right }); check(u.x >= first, 'the second time they appear, not the first', [u.x, first]) }
{ const c = await under.evaluate(e => getComputedStyle(e).textDecorationLine); check(!c.includes('underline'), "it isn't an underline he could have made", c) }
check(await mark.count() === 1, 'and the line has its mark')
// A reload draws it.
await page.reload(); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(2000); check(await under.count() === 1, 'a reload draws it', await under.count())
// Edited so the words aren't at their place: no underline on other words, the mark stays, and the pane keeps what was quoted.
await line.evaluate(n => { const text = document.createTreeWalker(n, NodeFilter.SHOW_TEXT).nextNode(), r = document.createRange(); r.setStart(text, 0); r.setEnd(text, 0); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }); await wait(300); await page.keyboard.type('X '); await wait(2600)
check(notes().document.includes('X A line'), 'typed before them'); check(await under.count() === 0, 'with the words moved, no underline, and none on the wrong words', await under.allInnerTexts()); check(await mark.count() === 1, 'the mark stays'); await shot('fallback')
await (wide ? mark.click() : mark.tap()); await wait(400); check((await pane.locator('.comment-quote').first().innerText()) === 'notes', 'and the pane keeps what was quoted', await pane.locator('.comment-quote').allInnerTexts())
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[comments words ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
