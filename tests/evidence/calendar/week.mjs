// R3-20 in the built app, on a fresh store from calendar/seed.ts: a calendar by week (Layout → Show as), and Week starts Monday moving
// the calendar, the date picker, the filter and group by week together.
// Usage: node tests/evidence/calendar/week.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, today, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !today || !width) { console.error('Usage: node tests/evidence/calendar/week.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/calendar/seed.ts ${storePath} ${today} first`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 1000 : 844 }, hasTouch: !wide, serviceWorkers: 'block', timezoneId: 'America/Vancouver' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const row = id => store().pages.find(p => p.id === id)
const view = () => row('list').database.views[0]
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(350) }
const day = d => block.locator(`.database-day[data-day="${d}"]`)
const shift = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const weekdays = () => block.locator('.database-calendar-weekday').allInnerTexts()
const label = () => block.locator('.database-calendar-month').innerText()

await page.goto(`${base}/pages?page=books`); await wait(2500)
// Sunday by default.
check((await weekdays())[0][0] === 'S', 'the month starts on Sunday', await weekdays())
// By week.
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: /Layout/ })); await wait(200)
await menu.getByLabel('Show as').selectOption('week'); await wait(900); await closeMenu()
check(view().calendarSpan === 'week', 'stored on the view')
check(await block.locator('.database-day').count() === 7, 'one week of days', await block.locator('.database-day').count())
const first = await block.locator('.database-day').first().getAttribute('data-day')
check(new Date(`${first}T12:00:00Z`).getUTCDay() === 0, 'from Sunday', first)
check(/–/.test(await label()), 'its dates in the heading', await label())
await shot('week')
if (wide) {
  check(await day(today).locator('.database-day-title').count() === 5 && await day(today).locator('.database-day-more').count() === 0, 'a week shows every title')
  await day(today).hover(); await day(today).locator('.database-day-add').click(); await wait(1200); await page.keyboard.type('Added in a week'); await page.keyboard.press('Enter'); await wait(1000)
  check(store().pages.find(p => p.title === 'Added in a week')?.values?.due?.start === today, '+ on a day works')
  const to = day(shift(1)), from = day(today).locator('.database-day-title').first(), id = await from.getAttribute('data-chip')
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 8, a.y + 6, { steps: 3 }); await page.mouse.move(b.x + b.width / 2, b.y + b.height - 8, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(1000)
  check(row(id).values.due.start === shift(1), 'dragging moves a row a day', row(id).values.due)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900); await clearNotices()
} else {
  check(await block.locator('.database-day-list .database-day-title').count() === 5, "the chosen day's rows are under the week")
}
check(await block.locator('.database-undated-head').count() === 1, 'the No date line is there')
const l0 = await label()
await tap(block.getByRole('button', { name: 'Next week' })); await wait(300)
check(await label() !== l0 && await block.locator('.database-calendar-today').count() === 1, 'next week, with a way back', await label())
await tap(block.locator('.database-calendar-today')); await wait(300)
check(await label() === l0, 'Today comes back')
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
// Week starts Monday, from the account line.
if (!wide) { await page.goto(`${base}/pages`); await wait(2000) }
await page.locator('select[aria-label="Week starts on"]:visible').first().selectOption('1'); await wait(900)
check(store().weekStart === 1, 'the setting is stored', store().weekStart)
if (!wide) { await page.goto(`${base}/pages?page=books`); await wait(2500) }
check((await weekdays())[0].startsWith('M'), 'the calendar starts on Monday', await weekdays())
const mon = await block.locator('.database-day').first().getAttribute('data-day')
check(new Date(`${mon}T12:00:00Z`).getUTCDay() === 1, 'its days too', mon)
// The date picker follows.
await page.goto(`${base}/`); await wait(2500)
await tap(page.locator('.day-title-trigger')); await wait(500)
const head = await page.locator('.day-picker th, .day-picker .calendar__grid-header-cell, .day-picker [class*=header-cell]').allInnerTexts()
check(head[0]?.trim().startsWith('M'), 'the date picker starts on Monday', head.slice(0, 2))
await page.keyboard.press('Escape'); await wait(300)
// Group by week follows.
await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: /Layout/ })); await wait(200); await tap(menu.getByRole('menuitemradio', { name: /Table/ })); await wait(900)
await tap(menu.getByLabel('Back')); await wait(200); await tap(menu.getByRole('button', { name: 'Group' })); await wait(200); await menu.getByLabel('Group by').selectOption({ label: 'Due' }); await wait(800); await menu.getByLabel('By', { exact: true }).selectOption('week'); await wait(900); await closeMenu()
const weekStartsOn = new Date(Date.parse(`${today}T12:00:00Z`) - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) * 86_400_000)
const expected = weekStartsOn.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
check((await block.locator('.database-group-fold').allInnerTexts()).some(t => t.includes(`Week of ${expected}`)), 'group by week starts on Monday', await block.locator('.database-group-fold').allInnerTexts())
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
