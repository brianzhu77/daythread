// R1-7: at 390 (touch) or 1280 (third argument `wide`), scroll the table sideways, open a cell's sheet and pick a value: the table keeps its sideways
// place through the sheet and the save. Usage: node tests/evidence/databases/keeps-place.mjs <base-url> [chromium|webkit]
import * as pw from '@playwright/test'
const base = process.argv[2], engine = process.argv[3] ?? 'chromium', wide = process.argv[4] === 'wide'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage(wide ? { viewport: { width: 1280, height: 900 } } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' })
const press = (l) => wide ? l.click() : l.tap()
const errors = []
page.on('pageerror', e => errors.push(e.message))
// On any failure: the error and a screenshot (FAIL_SHOT, default /tmp/keeps-place-fail.png).
const failShot = process.env.FAIL_SHOT ?? '/tmp/keeps-place-fail.png'
process.on('uncaughtException', async e => { console.error('ERROR', e.message.split('\n')[0]); await page.screenshot({ path: failShot }).catch(() => {}); process.exit(1) })
process.on('unhandledRejection', async e => { console.error('ERROR', String(e?.message ?? e).split('\n')[0]); await page.screenshot({ path: failShot }).catch(() => {}); process.exit(1) })
await page.goto(`${base}/pages?page=books`)
await page.waitForTimeout(2500)
const left = () => page.locator('.database-scroll').first().evaluate(el => el.scrollLeft)
await page.locator('.database-scroll').first().evaluate(el => { el.scrollLeft = 300 })
await page.waitForTimeout(300)
const before = await left()
await press(page.locator('.database-block').first().locator('.database-row').nth(1).locator('.database-td.is-select .database-cell'))
await page.waitForTimeout(800)
const sheetOpen = await page.locator(wide ? '.property-popover' : '.property-sheet').count()
const during = await left()
// Picks whichever genre the row doesn't have, inside the sheet.
const current = await page.locator('.database-block').first().locator('.database-row').nth(1).locator('.database-td.is-select').innerText()
await press(page.locator(wide ? '.property-popover' : '.property-sheet').getByText(current.includes('Essay') ? 'Novel' : 'Essay', { exact: true }).first())
await page.waitForTimeout(1500)
const after = await left()
console.log(JSON.stringify({ before, sheetOpen, during, after, errors }))
// Focus may nudge the cell into view by a few pixels; a reset would be 0.
if (before < 100 || Math.abs(during - before) > 60 || Math.abs(after - before) > 60 || errors.length) { console.error('FAIL'); await page.screenshot({ path: failShot }); process.exit(1) } else console.log('PASS')
await browser.close()
