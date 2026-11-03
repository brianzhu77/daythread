// R3-1 Calendar in the built app, on a fresh store from calendar/seed.ts: made from + Add view, asked or not; the month; a range;
// "+2" and the phone's chosen day; No date; + on a day; dragging with Undo, keeping time and length; a filter's notice; a failed save;
// a deleted property; keys and the clipboard.
// Usage: node tests/evidence/calendar/calendar.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, today, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !today || !width) { console.error('Usage: node tests/evidence/calendar/calendar.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/calendar/seed.ts ${storePath} ${today}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 1000 : 844 }, hasTouch: !wide, serviceWorkers: 'block', timezoneId: 'America/Vancouver' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const row = id => store().pages.find(p => p.id === id)
const view = () => row('list').database.views.at(-1)
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(350) }
const day = d => block.locator(`.database-day[data-day="${d}"]`)
const shift = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const sameMonth = n => shift(n).slice(0, 7) === today.slice(0, 7)

await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(block.locator('.database-view-name')); await wait(300)
await tap(menu.getByRole('menuitem', { name: '+ Add view' })); await wait(200)
await tap(menu.getByRole('menuitem', { name: 'Calendar' })); await wait(1000)
check(await menu.getByLabel('View name').inputValue().catch(() => '') === 'Calendar', 'one date property: not asked, named after its type')
await page.keyboard.press('Enter'); await wait(400); await closeMenu()
check(view().layout === 'calendar' && view().dateBy === 'due', 'stored as a calendar by Due', view())
await wait(400); await shot('month')
check(await block.locator('.database-day').count() % 7 === 0 && await block.locator('.database-calendar-weekday').count() === 7, 'whole weeks under 7 weekdays')
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
check(await block.locator(`.database-day.is-today`).getAttribute('data-day') === today, 'today is marked')
if (wide) {
  check(await day(today).locator('.database-day-title').count() === 3, 'up to 3 titles a day')
  check((await day(today).locator('.database-day-more').innerText()).trim() === '+2', 'then +2', await day(today).locator('.database-day-more').innerText())
  await day(today).locator('.database-day-more').click(); await wait(300)
  check(await block.locator('.database-day-list .database-day-title').count() === 5, '+2 lists the whole day under the month')
  check(await day(shift(1)).locator('.database-day-title', { hasText: 'A range' }).count() === 1 && await day(shift(3)).locator('.database-day-title', { hasText: 'A range' }).count() === 1, 'a range shows on its days')
} else {
  check(await day(today).locator('.database-day-dot').count() === 1 && await day(today).locator('.database-day-title').count() === 0, 'a dot on a day with rows')
  check(await block.locator('.database-day-list .database-day-title').count() === 5, "today's rows are under the month")
  await tap(day(shift(1)).locator('.database-day-number')); await wait(300)
  check((await block.locator('.database-day-list .database-day-title').allInnerTexts()).join().includes('A range'), "a tap shows that day's rows")
  await shot('chosen')
  check(await block.locator('.database-day-list .database-new').count() === 1, '+ New under the chosen day')
}
// Rows with no date stay in reach.
const undated = block.locator('.database-undated-head')
check(/^No date · 32/.test((await undated.innerText()).trim()) , 'No date, with its count', await undated.innerText())
check(await block.locator('.database-undated .database-day-title').count() === 0, 'closed until asked')
await tap(undated); await wait(300)
check(await block.locator('.database-undated .database-day-title').count() === 25, 'it opens in place, with the row cap', await block.locator('.database-undated .database-day-title').count())
await tap(block.locator('.database-undated .database-more')); await wait(300)
check(await block.locator('.database-undated .database-day-title').count() === 32, 'Show 25 more')
await shot('undated')
await tap(undated); await wait(200)
// Months.
const monthText = () => block.locator('.database-calendar-month').innerText()
const m0 = await monthText()
await tap(block.getByRole('button', { name: 'Next month' })); await wait(300)
check(await monthText() !== m0 && await block.locator('.database-calendar-today').count() === 1, 'next month, with a way back', await monthText())
const rev = store().revision
await tap(block.locator('.database-calendar-today')); await wait(300)
check(await monthText() === m0 && store().revision === rev, 'Today comes back, and saves nothing')
// Opening a row.
await tap(block.locator('.database-day-list .database-day-title').first()); await wait(1500)
check(page.url().includes('page=') && !page.url().includes('page=books'), 'a tap opens the row', page.url())
await page.goBack(); await wait(1600)
// + on a day.
if (wide) {
  const target = sameMonth(5) ? shift(5) : shift(-5)
  await day(target).hover(); await day(target).locator('.database-day-add').click(); await wait(1200)
  await page.keyboard.type('Added on a day'); await page.keyboard.press('Enter'); await wait(1000)
  const made = store().pages.find(p => p.title === 'Added on a day')
  check(made?.values?.due?.start === target, '+ on a day sets the date, and its name opens', made?.values)
  // Dragging: its date moves, keeping its time; one Undo.
  const drag = async (from, to) => { await page.evaluate(() => window.scrollTo(0, 0)); await wait(100); const a = await from.boundingBox(), b = await to.boundingBox(); await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 4, { steps: 3 }); await page.mouse.move(b.x + b.width / 2, b.y + b.height - 6, { steps: 8 }); await wait(150); return async () => { await page.mouse.up(); await wait(1000) } }
  await clearNotices()
  const to = sameMonth(2) ? shift(2) : shift(-2)
  const release = await drag(day(shift(1)).locator('.database-day-title', { hasText: 'At 9:30' }), day(to))
  check(await block.locator('.database-day.is-drop').count() === 1, 'the day under it is tinted')
  await shot('dragging')
  await release()
  check(row('timed').values.due.start === `${to}T09:30`, 'a row dragged to a day takes it, and keeps its time', row('timed').values.due)
  check(!page.url().includes('page=timed'), "a drag doesn't open the row")
  check(await page.getByText(/^Moved to /).count() >= 1, 'and says so')
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  check(row('timed').values.due.start === `${shift(1)}T09:30`, 'Undo puts it back')
  await clearNotices()
  // A range keeps its length, moved by how far it was dragged from the day he took it.
  if (sameMonth(4)) {
    const r = await drag(day(shift(2)).locator('.database-day-title', { hasText: 'A range' }), day(shift(4))); await r()
    check(row('range').values.due.start === shift(3) && row('range').values.due.end === shift(5), 'a range keeps its length', row('range').values.due)
    await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000); await clearNotices()
  }
  // A row with no date dragged from its list gets that day.
  await undated.click(); await wait(300)
  const r2 = await drag(block.locator('.database-undated .database-day-title', { hasText: 'Ubik' }), day(today)); await r2()
  check(row('ubik').values.due?.start === today, 'a row with no date dragged onto a day gets it', row('ubik').values.due)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000); await clearNotices(); await undated.click(); await wait(200)
  // A failed save stays shown where he dropped it.
  await page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
  const f = await drag(day(today).locator('.database-day-title').first(), day(to)); await f(); await wait(1200)
  check(await page.locator('.database-unsaved').count() === 1, 'a failed save says so')
  await shot('failed')
  await page.unroute('**/_serverFn/**')
  await page.locator('.database-unsaved').getByRole('button', { name: 'Undo' }).click(); await wait(800); await clearNotices()
  // Keys and the clipboard.
  const doc = () => row('books').document, doc0 = doc()
  await day(today).locator('.database-day-number').focus(); await page.keyboard.press('ArrowRight'); await wait(150)
  check(await page.evaluate(() => document.activeElement?.closest('[data-day]')?.dataset.day) === shift(1), 'arrows move between days')
  await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
  check(await page.evaluate(() => document.activeElement?.classList.contains('database-day-number')), 'Enter on the selected block comes to a day')
  for (const key of ['Backspace', 'Delete', 'ControlOrMeta+x', 'ControlOrMeta+v', '/', 'z', 'ControlOrMeta+a']) { await day(today).locator('.database-day-number').focus(); await page.keyboard.press(key); await wait(300) }
  check(doc() === doc0 && await block.locator('.database-calendar').count() === 1, 'keys and the clipboard leave the page and the block alone')
  const dated = day(today).locator('.database-day-title').first(), id = await dated.getAttribute('data-chip')
  await dated.focus(); await page.keyboard.press('Shift+ArrowRight'); await wait(1000)
  check(row(id).values.due.start === shift(1), 'Shift-arrow moves a row a day', row(id).values.due)
  await page.keyboard.press('ControlOrMeta+z'); await wait(1000)
  check(row(id).values.due.start === today, '⌘Z undoes it')
  await clearNotices()
  // A filter that then hides it says so.
  await tap(block.locator('.database-more-button')); await wait(300); await menu.getByRole('button', { name: 'Filter' }).click(); await menu.getByText('+ Add filter').click(); await wait(700)
  await menu.getByLabel('Property').last().selectOption({ label: 'Due' }); await wait(600); await menu.getByLabel('Day').last().selectOption('today'); await wait(800); await closeMenu()
  const hid = await drag(day(today).locator('.database-day-title').first(), day(to)); await hid()
  check(await page.getByText(/hidden by this view's filter/).count() >= 1, 'a row the filter then hides says so')
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(800); await clearNotices()
}
// Its property deleted: nothing missing, and a way to choose.
await tap(block.locator('.database-more-button')); await wait(300)
if (await menu.getByRole('button', { name: 'Filter' }).count() === 0) check(false, 'no menu')
await tap(menu.getByRole('menuitem', { name: /Properties/ })); await wait(200); await tap(menu.getByRole('button', { name: /^Due/ })); await wait(200)
await tap(menu.getByRole('menuitem', { name: 'Delete property' })); await wait(1100); await closeMenu()
check(await block.locator('.database-empty').getByRole('button', { name: 'Choose a date property' }).count() === 1, 'its property deleted: a way to choose one')
check(/^No date · /.test((await undated.innerText()).trim()), 'and every row is under No date', await undated.innerText())
await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
check(await block.locator('.database-empty').count() === 0 || view().filter.length > 0, 'Undo brings it back')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
