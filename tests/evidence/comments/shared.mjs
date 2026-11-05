// A comment on a synced line in the built app (comments.md §4): made from a place that isn't the original, it's on the shared line, shows on both pages with a mark, a reply from either lands on the one thread, and Unsync here takes it off that place.
// Usage: node tests/evidence/comments/shared.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/comments/shared.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/comments/seed-shared.ts ${S}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const threads = () => store().threads ?? []
const browser = await pw[engine].launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const send = engine === 'webkit' ? 'Meta+Enter' : 'Control+Enter', mod = engine === 'webkit' ? 'Meta' : 'Control'
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-shared-${name}.png` }) }
const pane = page.locator('.comments-pane'), field = page.getByRole('textbox', { name: 'New comment' }), mark = page.locator('.comment-mark'), count = page.locator('.comment-count')
const open = async id => { await page.goto(`${base}/pages?page=${id}`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(2000) }
const lineAt = words => page.locator('.bn-inline-content', { hasText: words }).first()
await open('other')
check(await mark.count() === 0, 'no marks to begin with')
await lineAt('First shared').click(); await wait(250); await page.keyboard.press(`${mod}+Shift+M`); await wait(400)
check((await pane.locator('.comment-quote').first().innerText()) === 'First shared', 'writing on a place of it, it quotes the line')
await field.fill('From the copy'); await field.press(send); await wait(1000)
{ const t = threads()[0]; check(t?.anchor?.blockId === 's1', 'it holds the shared line, not this place', t?.anchor); check(t?.pageId === 'other', 'and made here, this is its home', t?.pageId) }
await pane.getByRole('button', { name: 'Close comments' }).click(); await wait(350)
check(await mark.count() === 1, 'a mark on this page'); await shot('copy')
{ const m = await mark.boundingBox(), l = await lineAt('First shared').boundingBox(); check(Math.abs(m.y + m.height / 2 - (l.y + l.height / 2)) < 10, 'on that line', [m.y, l.y]) }
await open('notes')
check(await mark.count() === 1 && (await count.textContent()) === '1', 'the other page shows it too, with its count'); await shot('original')
{ const m = await mark.boundingBox(), l = await lineAt('First shared').boundingBox(); check(Math.abs(m.y + m.height / 2 - (l.y + l.height / 2)) < 10, "on the same line there", [m.y, l.y]) }
// A reply from the other place is on the one thread.
await mark.click(); await wait(350); await pane.getByRole('button', { name: 'Reply', exact: true }).click(); await page.getByRole('textbox', { name: 'Reply' }).fill('From the original'); await page.getByRole('textbox', { name: 'Reply' }).press(send); await wait(1000)
check(threads().length === 1 && threads()[0].comments.length === 2, 'a reply from either page is on the one thread', threads()[0].comments.map(c => c.body))
await page.locator('.comment-quote').first().click(); await wait(500)
{ const target = await page.locator('.is-comment-target').count(); check(target === 1, 'the quote goes to the line here') }
await pane.getByRole('button', { name: 'Close comments' }).click(); await wait(250)
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[comments shared ${engine}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
