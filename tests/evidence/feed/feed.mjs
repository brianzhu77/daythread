// Feed in the built app (feed.md): five cards with their titles, properties and bodies read only; Show more opens a long one in
// place and Show less closes it; a tick in a card is the task's command, changes no document, and has one Undo; a tap on a
// card's words raises no keyboard at 390; the title and + New open the row. Usage: node tests/evidence/feed/feed.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S || !width) { console.error('Usage: node tests/evidence/feed/feed.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/feed/seed.ts ${S}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver|access control/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const tap = l => (wide ? l.click() : l.tap())
const card = title => page.locator('.feed-card', { has: page.locator('.feed-title', { hasText: title }) })
await page.goto(`${base}/pages?page=reading`); await page.locator('.feed-card').first().waitFor({ timeout: 30000 }); await wait(1500)
check(await page.locator('.feed-card').count() === 5 && !(await page.locator('.bn-editor .feed-card .ProseMirror').count()), 'five cards, none an editor', await page.locator('.feed-card').count())
const first = await card('On slow mornings').innerText()
check(first.includes('Writing before reading') && first.includes('Tea, not the phone') && /Idea/.test(first), "a card has its title, properties and body", first.replace(/\s+/g, ' ').slice(0, 90))
check(await card('On slow mornings').locator('strong', { hasText: 'Writing before reading' }).count() === 1, 'bold stays bold')
check((await card('See also').innerText()).includes('Reading') && await card('See also').locator('.page-ref').count() === 1, 'a [[link]] reads as on the page')
// A folded toggle shows its words, not its lines; a stored href that isn't a web link is words, not a link (Roadbuster).
{ const see = card('See also'); const t = await see.innerText(); const hrefs = await see.locator('.feed-body a').evaluateAll(l => l.map(a => a.getAttribute('href')))
  check(t.includes('Folded notes') && !t.includes('Hidden under the toggle'), 'a folded toggle shows its words and not its lines', t.replace(/\s+/g, ' ').slice(0, 120))
  check(t.includes('not a link') && !hrefs.some(h => /^javascript:/i.test(h ?? '')) && hrefs.includes('https://example.com/ok'), "a javascript: href stays words; a web link stays a link", hrefs) }
// Show more and Show less.
const long = card('A long one'), clip = long.locator('.feed-clip')
const capped = await clip.evaluate(e => Math.round(e.getBoundingClientRect().height))
check(await clip.evaluate(e => e.classList.contains('is-clipped')) && capped === (wide ? 288 : 384), 'a long body is capped by height', capped)
await tap(long.locator('.feed-more')); await wait(400)
const open = await clip.evaluate(e => Math.round(e.getBoundingClientRect().height))
check(open > capped && (await long.locator('.feed-more').innerText()) === 'Show less', 'Show more opens it in place', open)
await tap(long.locator('.feed-more')); await wait(400)
check(await clip.evaluate(e => e.classList.contains('is-clipped')), 'and Show less closes it')
check(!(await card('On slow mornings').locator('.feed-more').count()), 'a short body has no Show more')
// A tick: the task's command, no document changed, one Undo.
const docs = () => JSON.stringify(store().pages.map(p => [p.id, p.document]))
const before = docs(), task = () => store().tasks.find(t => t.title === 'Try the two-minute rule')
await tap(card('Things to do from it').locator('[role=checkbox]')); await wait(1500)
check(task()?.status === 'done' && docs() === before, 'a tick marks the to-do done and changes no document', task()?.status)
if (!wide) check(await page.evaluate(() => !document.activeElement?.isContentEditable), 'and raises no keyboard')
await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1500)
check(task()?.status === 'open', 'one Undo reopens it', task()?.status)
// A tap on words opens nothing and raises no keyboard.
await tap(card('On slow mornings').locator('.feed-body p').first()); await wait(500)
check(new URL(page.url()).searchParams.get('page') === 'reading' && (wide || await page.evaluate(() => !document.activeElement?.isContentEditable)), wide ? 'a click on a body opens nothing' : 'a tap on a body opens nothing and raises no keyboard')
if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-feed.png`, fullPage: true })
// The title opens its row.
await tap(card('See also').locator('.feed-title')); await wait(1500)
check(new URL(page.url()).searchParams.get('page') === 'n4', 'the title opens its row', page.url())
await page.goBack(); await page.locator('.feed-card').first().waitFor({ timeout: 20000 }); await wait(1200)
// + New opens the new row.
const rows = store().pages.filter(p => p.parentId === 'notes').length
await tap(page.locator('.feed-new .database-new')); await wait(1800)
const made = store().pages.filter(p => p.parentId === 'notes')
const opened = new URL(page.url()).searchParams
check(made.length === rows + 1 && (opened.get('peek') === made.at(-1).id || opened.get('page') === made.at(-1).id), wide ? '+ New makes a row and opens it in a peek' : '+ New makes a row and opens its page', page.url())
check(errors.length === 0, 'no page errors', errors.slice(0, 2))
console.log(`[feed ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
