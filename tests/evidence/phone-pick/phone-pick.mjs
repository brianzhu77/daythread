// R3-15 Several rows on the phone, in the built app, on a fresh store from board/seed-board.ts: Select rows and a long-press start it, a tap ticks,
// the bar stays above the toolbar, Edit and Delete of several are one Undo, and 1280 keeps its own way. (A real long-press is run natively: see RESULTS.md.)
// Usage: node tests/evidence/phone-pick/phone-pick.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/phone-pick/phone-pick.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
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
const bar = block.locator('.database-picked-bar')
const row = id => block.locator(`tr.database-row[data-row="${id}"]`)
const name = id => row(id).locator('.database-title-cell')
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }

await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(block.locator('.database-more-button')); await wait(300)
const offered = await menu.getByRole('menuitem', { name: 'Select rows' }).count()
if (wide) {
  check(offered === 0, '1280 has its boxes, so no Select rows')
  await closeMenu()
  await row('dune').hover(); await row('dune').locator('.database-row-pick').click(); await wait(200)
  check((await bar.innerText()).includes('1 row') && !(await bar.getAttribute('class')).includes('is-picking'), "1280's bar is as it was")
  await name('emma').click(); await wait(1500)
  check(page.url().includes('page=emma'), 'and Name still opens a row')
} else {
  check(offered === 1, 'a phone table offers Select rows')
  await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(400)
  check(await block.locator('.database-row-tick').count() > 0 && (await bar.innerText()).includes('0 rows'), 'it starts with a box on each row and none ticked', await bar.innerText())
  await tap(name('dune')); await wait(200)
  await tap(row('emma').locator('td').nth(1)); await wait(200)
  check(page.url().includes('page=books') && (await bar.innerText()).includes('2 rows'), 'a tap ticks a row, on Name or a cell, and opens nothing', await bar.innerText())
  check(await page.locator('.property-field').count() === 0, 'nor a cell editor')
  await tap(name('emma')); await wait(200)
  check((await bar.innerText()).includes('1 row'), 'a second tap unticks')
  await tap(name('emma')); await wait(200)
  await shot('picking')
  const geometry = await page.evaluate(() => { const b = document.querySelector('.database-picked-bar').getBoundingClientRect(), t = document.querySelector('.tab-bar').getBoundingClientRect(); return { bottom: b.bottom, tabTop: t.top, height: b.height, left: b.left, right: b.right, width: innerWidth } })
  check(geometry.bottom <= geometry.tabTop && geometry.left >= 0 && geometry.right <= geometry.width, 'the bar sits above the toolbar, on screen', geometry)
  const kinds = () => ['dune', 'emma'].map(id => pageOf(id).values?.pages)

  // Edit of several: one change, one Undo.
  const before = kinds()
  await tap(bar.getByRole('button', { name: /Edit property/ })); await wait(300)
  const editMenu = block.locator('.database-picked-menu')
  const box = await editMenu.boundingBox()
  check(box.y >= 0 && box.y + box.height <= geometry.tabTop, 'its menu opens on screen', box)
  await tap(editMenu.getByRole('menuitem', { name: 'Pages' })); await wait(400)
  await page.locator('.property-field').fill('7'); await wait(100)
  await page.getByText('Done', { exact: true }).last().tap(); await wait(1200)
  check(kinds().every(v => v === 7), 'Edit changes both', kinds())
  const undoEdit = page.getByRole('button', { name: 'Undo' }).first()
  await tap(undoEdit); await wait(1000)
  check(JSON.stringify(kinds()) === JSON.stringify(before), 'one Undo takes back both', kinds())

  // All, Delete, one Undo.
  await tap(bar.getByRole('button', { name: 'All' })); await wait(200)
  const everyRow = store().pages.filter(p => p.parentId === 'list' && !p.trashedAt).length
  check((await bar.innerText()).includes(`${everyRow} rows`), 'All picks every row the view shows, past those drawn', await bar.innerText())
  await tap(bar.getByRole('button', { name: 'Done' })); await wait(300)
  check(await bar.count() === 0 && await block.locator('.database-row-tick').count() === 0, 'Done ends it')
  await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(300)
  await tap(name('ubik')); await wait(150); await tap(name('blank')); await wait(150)
  await tap(bar.getByRole('button', { name: 'Delete' })); await wait(1100)
  check(Boolean(pageOf('ubik').trashedAt) && Boolean(pageOf('blank').trashedAt) && await bar.count() === 0, 'Delete takes both, and ends it')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
  check(!pageOf('ubik').trashedAt && !pageOf('blank').trashedAt, 'one Undo brings back both')

  // A long press on Name picks that row; moving first doesn't; a tap after still opens.
  const press = async (id, moveBy = 0, hold = 560) => {
    const b = await name(id).boundingBox(), x = b.x + 30, y = b.y + b.height / 2
    await name(id).evaluate((el, a) => { const o = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientX: a.x, clientY: a.y, isPrimary: true }; el.dispatchEvent(new PointerEvent('pointerdown', o)); if (a.moveBy) el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientY: a.y + a.moveBy })) }, { x, y, moveBy })
    await wait(hold)
    await name(id).evaluate((el, a) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientX: a.x, clientY: a.y })), { x, y })
    await wait(150)
  }
  await press('dune', 20)
  check(await bar.count() === 0, 'moving first stays a scroll')
  await press('dune', 0, 200)
  check(await bar.count() === 0, 'a short press does nothing')
  await press('dune')
  check((await bar.innerText()).includes('1 row') && await row('dune').locator('.database-row-tick:checked').count() === 1, 'a long press on Name picks that row', await bar.innerText())
  await tap(bar.getByRole('button', { name: 'Done' })); await wait(300)
  await tap(name('emma')); await wait(1500)
  check(page.url().includes('page=emma'), 'after Done a tap opens a row again')
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
