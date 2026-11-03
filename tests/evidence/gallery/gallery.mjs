// R3-3 Gallery in the built app, on a fresh store from gallery/seed.ts: made from + Add view; 3 across, 2 on the phone; a card with
// an image, one whose image fails, and one with none; opening a row; a tick; + New; the cap; no Group; keys and the clipboard.
// Usage: node tests/evidence/gallery/gallery.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/gallery/gallery.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/gallery/seed.ts ${storePath} ${base}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
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
const card = id => block.locator(`.database-gallery-card[data-row="${id}"]`)

await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(block.locator('.database-view-name')); await wait(300)
await tap(menu.getByRole('menuitem', { name: '+ Add view' })); await wait(200)
await tap(menu.getByRole('menuitem', { name: 'Gallery' })); await wait(1000)
check(await menu.getByLabel('View name').inputValue().catch(() => '') === 'Gallery', 'named after its type, ready to rename')
await page.keyboard.press('Enter'); await wait(400); await closeMenu()
check(view().layout === 'gallery' && view().columns.length === 0, 'stored as a gallery, cards as titles', view().layout)
await wait(1200); await shot('gallery')
const tops = await block.locator('.database-gallery-card').evaluateAll(l => l.slice(0, 4).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width } }))
const across = new Set((await block.locator('.database-gallery-card').evaluateAll(l => l.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().x))))).size
check(across === (wide ? 3 : 2), `${wide ? 3 : 2} across`, tops)
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
const naturalWidth = await card('dune').locator('img').evaluate(i => i.naturalWidth).catch(() => 0)
check(await card('dune').locator('img').count() === 1 && naturalWidth > 0, 'a card shows the first image in its body', naturalWidth)
check(await card('emma').locator('img').count() === 0, 'one whose image fails is just its words')
check(await card('ubik').locator('img').count() === 0, 'one with no image has no frame')
const heights = await Promise.all(['dune', 'ubik'].map(id => card(id).evaluate(e => e.getBoundingClientRect().height)))
check(heights[1] < heights[0], "and it's shorter", heights)
check(await block.locator('.database-gallery-card').count() === 25, 'follows the row cap', await block.locator('.database-gallery-card').count())
await tap(block.locator('.database-table-wrap > .database-more')); await wait(300)
check(await block.locator('.database-gallery-card').count() === 34, 'Show 25 more')
await page.evaluate(() => window.scrollTo(0, 0)); await wait(200)
// Opening, and Back.
await tap(card('ubik').locator('.database-gallery-title')); await wait(1500)
check(page.url().includes('page=ubik'), 'a tap opens the row', page.url())
await page.goBack(); await wait(800)
check(await block.locator('.database-gallery-card.is-returned').count() === 1, 'back from a row, its card is tinted')
await wait(1000)
// No Group; Properties put a box on the card, and it ticks in place.
await tap(block.locator('.database-more-button')); await wait(300)
check(await menu.getByRole('button', { name: 'Group' }).count() === 0, 'no Group on a gallery')
await tap(menu.getByRole('menuitem', { name: /Properties/ })); await wait(200)
await menu.getByLabel('Show Owned').click(); await wait(900); await closeMenu()
await tap(card('emma').locator('.property-checkbox')); await wait(1100)
check(row('emma').values.owned === true && page.url().includes('page=books'), 'a tick saves in place, and opens nothing')
// + New.
await page.locator('.database-table-wrap > .database-new').first().scrollIntoViewIfNeeded()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
if (wide) { await page.keyboard.type('A new card'); await page.keyboard.press('Enter'); await wait(1000); check(await card(store().pages.find(p => p.title === 'A new card')?.id).count() === 1, '+ New types its name') }
else { const made = store().pages.filter(p => p.parentId === 'list').at(-1); check(page.url().includes(made.id), '+ New opens the row'); await page.goBack(); await wait(1500) }
if (wide) {
  // Keys and the clipboard.
  const doc = () => row('books').document, doc0 = doc()
  await card('dune').locator('.database-gallery-title').focus(); await page.keyboard.press('ArrowRight'); await wait(100)
  check(await page.evaluate(() => document.activeElement?.closest('[data-row]')?.dataset.row) === 'emma', 'arrows move between cards')
  await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
  check(await page.evaluate(() => document.activeElement?.classList.contains('database-gallery-title')), 'Enter on the selected block comes to its first card')
  for (const key of ['Backspace', 'Delete', 'ControlOrMeta+x', 'ControlOrMeta+v', '/', 'z', 'ControlOrMeta+a']) { await card('dune').locator('.database-gallery-title').focus(); await page.keyboard.press(key); await wait(350) }
  check(doc() === doc0 && await block.locator('.database-gallery').count() === 1 && !row('dune').trashedAt, 'keys and the clipboard on a card leave the page and the block alone')
  const named = () => store().pages.find(p => p.parentId === 'list' && p.title === 'A new card')
  check(Boolean(named()), 'the new card is there to undo')
  await card('dune').locator('.database-gallery-title').focus(); await page.keyboard.press('ControlOrMeta+z'); await wait(1000)
  check(!named(), '⌘Z undoes the last change')
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
