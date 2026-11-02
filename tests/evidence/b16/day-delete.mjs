// B16: deleting a day page, in the built app, on a fresh store from seed-day.ts: its ⋯, the notice and Undo, the date's
// "in Trash" state (no new page made, so Undo survives), Trash, Restore, and a new page joining the restored one.
// Usage: node tests/evidence/b16/day-delete.mjs <base-url> <store-path> <today> <blank-day> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, today, blank, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !today || !blank || !width) { console.error('Usage: node tests/evidence/b16/day-delete.mjs <base-url> <store-path> <today> <blank-day> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/b16/seed-day.ts ${storePath} ${today} ${blank}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wide = width === '1280'
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, isMobile: !wide && engine === 'chromium' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const dayPages = () => store().pages.filter(p => p.type === 'daily' && p.date === today)
const live = () => dayPages().filter(p => !p.trashedAt)
const tap = l => wide ? l.click() : l.tap()
const menu = () => page.getByRole('button', { name: 'Day actions' })
// A notice at the top of a phone's screen covers the header for its few seconds, as on any page: it's closed first.
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(400) }
const del = async () => { await clearNotices(); await tap(menu()); await tap(page.getByRole('menuitem', { name: 'Delete' })); await wait(900) }
const inTrash = () => page.getByText("Today's page is in Trash.")

await page.goto(`${base}/`); await wait(3000)
// The ⋯ is on the screen, and the header still fits.
const box = await menu().boundingBox()
check(box && box.x + box.width <= Number(width), '⋯ is inside the screen', box)
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on the page')
await shot('header')
await page.goto(`${base}/day/2026-09-30`); await wait(2000)
const fit = await page.evaluate(() => { const t = document.querySelector('.day-title-trigger').getBoundingClientRect(), n = document.querySelector('.day-nav').getBoundingClientRect(), m = document.querySelector('.day-nav .page-more').getBoundingClientRect(); return { titleRight: Math.round(t.right), titleH: Math.round(t.height), navLeft: Math.round(n.left), moreRight: Math.round(m.right), w: innerWidth } })
check(fit.titleRight <= fit.navLeft && fit.moreRight <= fit.w && fit.titleH <= 44, 'a long date fits on one line', fit)
await shot('header-long')
await page.goto(`${base}/day/${blank}`); await wait(2000)
check(await menu().count() === 0, 'a day with nothing written has no ⋯')

await page.goto(`${base}/`); await wait(2500)
await del()
check(await page.getByText('Moved to trash · 1 subpage').count() === 1, 'notice counts the subpage')
check(await inTrash().count() === 1, "says today's page is in Trash")
check(live().length === 0 && dayPages().length === 1, 'no new page was made', dayPages().map(p => p.id))
check(store().pages.find(p => p.id === 'trip').trashedAt != null, 'its subpage went with it')
check(store().tasks.find(t => t.title === 'Call Sam').status === 'open', 'its to-do stays open')
await shot('in-trash')
// Undo, from the notice.
await tap(page.getByRole('button', { name: 'Undo' })); await wait(1200)
check(live().length === 1 && await page.getByText('Slept well').count() === 1, 'Undo brings the page back on screen')
check(store().pages.find(p => p.id === 'trip').trashedAt == null, 'and its subpage')

// Restore from the date's own state.
await del()
await tap(page.getByRole('button', { name: 'Restore' })); await wait(1200)
check(await page.getByText('Slept well').count() === 1 && live().length === 1, 'Restore on the date brings it back')

// Trash: the row, then the read-only page, then Restore from its banner.
await del()
await page.goto(`${base}/pages?view=trash`); await wait(2000)
const row = page.locator('.trash-row').first()
const rowText = await row.innerText()
check(/Today/.test(rowText) && /From Days/.test(rowText) && /with 1 subpage/.test(rowText) && !/Untitled|\d{4}-\d{2}-\d{2}/.test(rowText), 'Trash row names the day', rowText.replace(/\n/g, ' | '))
await shot('trash')
await tap(row.locator('.card-row')); await wait(1500)
check(page.url().includes('/pages?page=') && await page.locator('.trash-banner').count() === 1, 'opens read-only from Trash', page.url())
check(await page.getByText('Slept well').count() === 1 && /was in Days/.test(await page.locator('.trash-banner').innerText()), 'shows its lines and where it was')
await shot('read-only')
await tap(page.locator('.trash-banner .restore-button')); await wait(1500)
check(new URL(page.url()).pathname === `/day/${today}`, 'restored from its banner, it goes to its date', page.url())
check(live().length === 1, 'one live page')

// Start a new page, write on it, then Restore: joined, with Undo.
await page.goto(`${base}/`); await wait(2500)
await del()
await tap(page.getByRole('button', { name: 'Start a new page' })); await wait(1500)
check(live().length === 1 && live()[0].id !== `day:${today}`, 'Start a new page makes its own', live().map(p => p.id))
await page.locator('.bn-inline-content').last().click(); await page.keyboard.type('Second try'); await wait(1800)
await page.locator('h1').first().click().catch(() => {}); await wait(1200)
check(JSON.stringify(live()[0].document).includes('Second try'), 'the new page saved its line')
await page.goto(`${base}/pages?view=trash`); await wait(2000)
await tap(page.locator('.trash-row .restore-button').first()); await wait(1500)
check(await page.getByText('Restored · joined with the new page').count() === 1, 'notice says joined')
check(live().length === 1 && live()[0].document.includes('Slept well') && live()[0].document.includes('Second try'), 'both lines on one page')
check(live()[0].document.indexOf('Slept well') < live()[0].document.indexOf('Second try'), 'restored lines first')
await tap(page.getByRole('button', { name: 'Undo' })); await wait(1500)
check(live().length === 1 && !live()[0].document.includes('Slept well') && dayPages().length === 2, 'Undo puts both pages back', dayPages().map(p => [p.id, Boolean(p.trashedAt)]))

// Deleted twice: Restore brings back the newest; the other stays in Trash.
await page.goto(`${base}/`); await wait(2500)
await del()
check(await inTrash().count() === 1 && dayPages().filter(p => p.trashedAt).length === 2, 'deleted twice, both in Trash')
await tap(page.getByRole('button', { name: 'Restore' })); await wait(1500)
check(live().length === 1 && live()[0].document.includes('Second try') && !live()[0].document.includes('Slept well'), 'Restore brings back the newest')
check(dayPages().filter(p => p.trashedAt).length === 1, 'the older stays in Trash')

// A second tab moves the workspace on while this one shows "in Trash": Restore works the first time.
await page.goto(`${base}/`); await wait(2500)
const tab2 = await context.newPage()
await tab2.goto(`${base}/day/2026-09-30`); await wait(2500)
await page.bringToFront(); await del()
await tab2.bringToFront(); await tab2.locator('.bn-inline-content').last().click(); await tab2.keyboard.type('From the other tab'); await wait(2200)
await tab2.close(); await page.bringToFront()
const before = store().revision
await tap(page.getByRole('button', { name: 'Restore' })); await wait(1800)
check(live().length === 1 && await inTrash().count() === 0, 'Restore works the first time after another tab saved', { before, after: store().revision })

if (wide) {
  // The sidebar's row: same Delete, and it stays on the date.
  await page.goto(`${base}/`); await wait(2500)
  const treeRow = page.locator(`.tree-row[data-kind="day"]`).first()
  await treeRow.hover()
  const more = treeRow.locator('.tree-more')
  check(await more.count() === 1, "the sidebar's day row has a ⋯")
  await more.click(); await page.getByRole('menuitem', { name: 'Delete' }).click(); await wait(1000)
  check(await inTrash().count() === 1 && new URL(page.url()).pathname !== '/pages', 'deleting it from the sidebar stays on the date', page.url())
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
