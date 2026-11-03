// R3-21 Calendar by Created or Edited time, and its place kept on this device; R3-9 an ID's prefix. In the built app, on a fresh store.
// Usage: node tests/evidence/calendar-by-time/calendar-by-time.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/calendar-by-time/calendar-by-time.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/calendar-by-time/seed-calendar-time.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const openPanel = async name => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name }).first()); await wait(300) }
const heading = () => block.locator('.database-calendar-month').innerText()
const toJanuary = async () => { for (let i = 0; i < 24 && await heading() !== 'January 2026'; i++) { await tap(block.getByRole('button', { name: 'Previous month' })); await wait(120) } }
const dateByOf = () => row('list').database.views[0].dateBy
const dayCell = day => block.locator(`[data-day="${day}"]`)

await page.goto(`${base}/pages?page=books`); await wait(2500)
const startRevision = store().revision
await openPanel('Layout'); await tap(menu.getByRole('menuitemradio', { name: 'Calendar' })); await wait(500)
const choices = await menu.getByRole('menuitem').allInnerTexts()
check(['Due', 'Made', 'Changed'].every(n => choices.some(c => c.includes(n))), 'Created and Edited time are offered', choices)
await tap(menu.getByRole('menuitem', { name: 'Made' })); await wait(800); await closeMenu()
check(dateByOf() === 'made', 'it sits by Created time', dateByOf())

// January's row, on its day. No +, no No date line.
const now = await heading()
await toJanuary()
const janDay = await page.evaluate(() => { const d = new Date('2026-01-15T18:00:00.000Z'); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
if (wide) check((await dayCell(janDay).innerText()).includes('From January'), 'a row on the day it was made', janDay)
else {
  check(await dayCell(janDay).locator('.database-day-dot').count() === 1, 'a dot on the day it was made', janDay)
  await tap(dayCell(janDay).locator('.database-day-number')); await wait(400)
  check((await block.locator('.database-day-list').innerText()).includes('From January'), 'and its row under the month')
  check(await block.locator('.database-day-list .database-new').count() === 0, 'the day has no + New')
}
check(await block.locator('.database-day-add').count() === 0, 'a day has no +')
check((await block.locator('.database-undated-head').innerText()).includes('No date · 1'), 'a row with no time stays in reach', await block.locator('.database-undated-head').innerText())
await tap(block.locator('.database-undated-head')); await wait(300)
const undatedTitle = block.locator('.database-undated .database-day-title')
check((await undatedTitle.innerText()) === 'From before', 'it opens in place', await undatedTitle.innerText())
if (wide) {
  const was = JSON.stringify(row('legacy')), a = await undatedTitle.boundingBox(), to = await dayCell(janDay).boundingBox()
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(to.x + 20, to.y + 20, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(700)
  check(JSON.stringify(row('legacy')) === was, "it doesn't drag from there")
}
await tap(block.locator('.database-undated-head')); await wait(300)
await shot('january')

// It can't move.
if (wide) {
  const was = JSON.stringify(row('old'))
  const title = dayCell(janDay).locator('.database-day-title').first(), to = await dayCell(janDay).boundingBox()
  const a = await title.boundingBox()
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(to.x - 150, to.y + 20, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(700)
  check(JSON.stringify(row('old')) === was && await block.locator('.database-calendar.is-dragging').count() === 0, 'a drag does nothing')
  check(page.url().includes('page=books'), 'and opens nothing')
  await title.focus(); await page.keyboard.press('Shift+ArrowRight'); await wait(500)
  check(JSON.stringify(row('old')) === was, 'Shift-arrow does nothing')
  check((await dayCell(janDay).innerText()).includes('From January'), 'it stays on its day')
}

// Its place stays on this device, and isn't a save.
const revision = store().revision
await page.reload(); await wait(2500)
check(await heading() === 'January 2026', 'it comes back to the month it was left on', await heading())
await tap(block.getByRole('button', { name: 'Next month' })); await wait(300)
await page.goto(`${base}/pages`); await wait(1500); await page.goto(`${base}/pages?page=books`); await wait(2500)
check(await heading() === 'February 2026', 'after going elsewhere too', await heading())
check(store().revision === revision, 'no save for looking', [revision, store().revision])
const other = await context.browser().newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const fresh = await other.newPage(); await fresh.goto(`${base}/pages?page=books`); await fresh.waitForTimeout(2500)
check(await fresh.locator('.database-calendar-month').first().innerText() === now, 'another device opens on today', await fresh.locator('.database-calendar-month').first().innerText())
await other.close()
await tap(block.locator('.database-calendar-today')); await wait(400)
check(await heading() === now, 'Today goes back', await heading())
await page.reload(); await wait(2500)
check(await heading() === now, 'and is what stays', await heading())

// Edited time, then a Date property keeps its + and its line.
await openPanel('Layout'); await menu.locator('label.database-menu-row', { hasText: 'Show calendar by' }).locator('select').selectOption({ label: 'Changed' }); await wait(800); await closeMenu()
check(dateByOf() === 'seen' && await block.locator('.database-day-add').count() === 0 && await block.locator('.database-undated').count() === 1, 'Edited time is the same')
await shot('edited')
await openPanel('Layout'); await menu.locator('label.database-menu-row', { hasText: 'Show calendar by' }).locator('select').selectOption({ label: 'Due' }); await wait(800); await closeMenu()
check(dateByOf() === 'due' && await block.locator('.database-undated').count() === 1, 'a Date property keeps its No date line')
if (wide) check(await block.locator('.database-day-add').count() > 0, 'and its +')
else { await tap(block.locator('.database-day-number').nth(10)); await wait(300); check(await block.locator('.database-day-list .database-new').count() === 1, 'and its + New') }
await openPanel('Layout'); await tap(menu.getByRole('menuitemradio', { name: 'Table' })); await wait(900); await closeMenu()

// The prefix.
const numbers = () => store().pages.filter(p => p.parentId === 'list').map(p => p.values?.['@id']).join()
const was = numbers()
await openPanel('Properties'); await tap(menu.getByRole('button', { name: /^No\./ })); await wait(300)
await menu.getByLabel('Prefix').fill('BK-'); await page.keyboard.press('Enter'); await wait(800)
await shot('prefix')
await closeMenu()
const cell = id => block.locator(`tr.database-row[data-row="${id}"] td.is-id`)
check((await cell('dune').innerText()).trim() === 'BK-1', 'the cell shows it', await cell('dune').innerText())
check(numbers() === was, 'no number changed')
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(300)
await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'No.' }); await wait(700)
await menu.getByLabel('Condition').last().selectOption('gt'); await wait(500)
await menu.getByLabel('Value').last().fill('BK-33'); await page.keyboard.press('Enter'); await wait(900)
check(row('list').database.views[0].filter[0].value === 33, 'a filter takes it as it shows', row('list').database.views[0].filter[0].value)
await closeMenu()
const high = new Set(await block.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row)))
check(high.size === 3 && high.has('old') && high.has('legacy'), 'and filters by the number', [...high])
check((await block.locator('.database-chip-open').first().innerText()).includes('BK-33'), 'its line reads as it shows', await block.locator('.database-chip-open').first().innerText())
await shot('prefix-filter')
await page.goto(`${base}/pages?page=old`); await wait(2500)
check((await page.locator('.row-property', { hasText: 'No.' }).innerText()).includes('BK-35'), 'the row page shows it', await page.locator('.row-property', { hasText: 'No.' }).innerText())
check(store().revision > startRevision, 'the store moved only for real changes')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
