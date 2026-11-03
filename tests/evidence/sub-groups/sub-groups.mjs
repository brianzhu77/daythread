// R3-13 Sub-groups in the built app, on a fresh store from board/seed-board.ts: set from Group; a table's sections, their folds, cap and + New;
// a drag across both layers with one Undo; list, gallery and a board's lanes; hiding a sub-group; a reload; and None.
// Usage: node tests/evidence/sub-groups/sub-groups.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/sub-groups/sub-groups.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const firstView = () => pageOf('list').database.views[0]
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
const openGroup = async () => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300) }
const layout = async name => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name })); await wait(700); if (await menu.getByRole('menuitem', { name: 'Status' }).count()) { await tap(menu.getByRole('menuitem', { name: 'Status' }).first()); await wait(600) } await closeMenu(); await wait(300) }
const subs = async () => (await block.locator('.database-group-inner.is-sub').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())
const leave = async () => { if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) } }
const SEP = '\u0001'
const section = (g, s) => `${g}${SEP}${s}`
const inSection = (g, s) => block.locator(`[data-group="${section(g, s)}"]`)

await page.goto(`${base}/pages?page=books`); await wait(2500)
await openGroup()
check(await menu.getByLabel('Sub-group by').count() === 0, 'no second layer until there is a first')
await menu.locator('label.database-menu-row', { hasText: 'Group by' }).first().locator('select').selectOption({ label: 'Status' }); await wait(800)
check((await menu.getByLabel('Sub-group by').locator('option').allInnerTexts()).every(o => o !== 'Status'), "the group's own property isn't offered")
await menu.getByLabel('Sub-group by').selectOption({ label: 'Kind' }); await wait(800)
await shot('panel')
await closeMenu()
check(firstView().subGroupBy === 'kind', 'saved on the view', firstView().subGroupBy)
const heads = await subs()
check(heads.length >= 3 && heads.some(h => h === 'Essay · 31'), 'a table draws the second layer, with counts', heads)
await shot('table')

// Indent: one step in, and rows stay on their column.
const indent = await page.evaluate(() => {
  const left = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left }
  const group = [...document.querySelectorAll('.database-group-inner:not(.is-sub) .database-group-fold')][0], sub = document.querySelector('.database-group-inner.is-sub .database-group-fold')
  return left(sub) - left(group)
})
check(Math.abs(indent - 16) < 1, 'a sub-group sits one step in', indent)

// Cap and Show more, per section.
const finished = block.locator('tr.database-row[data-group="' + section('done', 'essay') + '"]')
check(await finished.count() === 25, 'a section has its own cap', await finished.count())
await tap(block.locator(`tr.database-group-foot[data-group="${section('done', 'essay')}"] .database-more`)); await wait(400)
check(await finished.count() === 31, 'and its own Show more', await finished.count())

// Fold: the section, then its group.
const essayHead = block.locator('.database-group-inner.is-sub', { hasText: /Essay\s*· 31/ }).locator('.database-group-fold')
await tap(essayHead); await wait(300)
check(await finished.count() === 0, 'a sub-group folds')
await tap(essayHead); await wait(300)
check(await finished.count() === 31, 'and opens')

// + New in a section starts with both.
const ids = () => new Set(store().pages.filter(p => p.parentId === 'list').map(p => p.id))
let before = ids()
await tap(block.locator(`tr.database-group-foot[data-group="${section('now', 'essay')}"] .database-new`)); await wait(1400)
let made = store().pages.find(p => p.parentId === 'list' && !before.has(p.id))
check(made?.values?.status === 'now' && made?.values?.kind === 'essay', '+ New starts with both values', made?.values)
await leave()

// A drag across both layers: both values, one Undo. A mouse only.
if (wide) {
  const row = block.locator('tr.database-row[data-row="dune"]')
  await row.scrollIntoViewIfNeeded(); await row.hover()
  const h = await row.locator('.database-row-handle').boundingBox()
  const foot = block.locator(`tr.database-group-foot[data-group="${section('todo', 'essay')}"]`)
  await foot.scrollIntoViewIfNeeded(); await wait(150)
  await row.scrollIntoViewIfNeeded(); await row.hover(); const h2 = await row.locator('.database-row-handle').boundingBox()
  const to = await foot.boundingBox()
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2); await page.mouse.down()
  await page.mouse.move(h2.x + 8, h2.y + 8, { steps: 3 }); await wait(80)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.2, { steps: 10 }); await wait(200)
  await page.mouse.up(); await wait(1000)
  check(pageOf('dune').values.status === 'todo' && pageOf('dune').values.kind === 'essay', 'a drag changes both', [pageOf('dune').values.status, pageOf('dune').values.kind, Boolean(h)])
  check(await page.getByText(/Moved to To read · Essay/).count() >= 1, 'and says where')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
  check(pageOf('dune').values.status === 'now' && pageOf('dune').values.kind === 'novel', 'one Undo takes back both', [pageOf('dune').values.status, pageOf('dune').values.kind])
}

// Hide a sub-group, then bring it back; a reload keeps the layer.
await openGroup()
const list = menu.locator('.database-group-list').last()
await tap(list.getByLabel('Show Essay')); await wait(800); await closeMenu()
check(firstView().hiddenSubGroups?.includes('essay') && !(await subs()).some(h => h.startsWith('Essay')), 'a sub-group hides', await subs())
check((await block.locator('.database-hidden-groups').allInnerTexts()).some(t => t.includes('Essay')), 'and is listed as hidden')
await tap(block.locator('.database-hidden-groups').getByRole('button', { name: /Essay/ })); await wait(800)
check(!firstView().hiddenSubGroups?.length, 'a tap brings it back')
await page.reload(); await wait(2500)
check((await subs()).filter(h => h === 'Essay · 1').length === 1 && (await subs()).some(h => h === 'Essay · 31'), 'it stays after a reload, with the new row in its section', await subs())

// List and gallery.
await layout('List')
check((await subs()).some(h => h.startsWith('Essay')) && await inSection('now', 'novel').count() >= 1, 'a list draws both layers')
await shot('list')
before = ids()
await tap(block.locator(`.database-list-foot[data-group="${section('todo', 'essay')}"] .database-new`)); await wait(1400)
made = store().pages.find(p => p.parentId === 'list' && !before.has(p.id))
check(made?.values?.status === 'todo' && made?.values?.kind === 'essay', "a list's + New starts with both", made?.values)
await leave()
await layout('Gallery')
check((await subs()).some(h => h.startsWith('Essay')) && await block.locator('.database-gallery').count() >= 3, 'a gallery draws both layers')
await shot('gallery')

// A board: lanes of the same columns; the heads once.
await layout('Board')
const lanes = await block.locator('.database-lane').count()
check(lanes >= 3, 'a board draws a lane per sub-group', lanes)
const columnHeads = await block.locator('.database-column-head').allInnerTexts()
check(columnHeads.length === 3, 'with the column heads once', columnHeads)
check(await block.locator('.database-column[data-column]').count() === lanes * 3, 'and the same columns in each lane', await block.locator('.database-column[data-column]').count())
await shot('board')
before = ids()
await tap(block.locator(`.database-column[data-column="${section('now', 'essay')}"] .database-new`)); await wait(1400)
made = store().pages.find(p => p.parentId === 'list' && !before.has(p.id))
check(made?.values?.status === 'now' && made?.values?.kind === 'essay', "a lane's + New starts with both", made?.values)
await leave()
if (wide) {
  const card = block.locator(`.database-column[data-column="${section('now', 'novel')}"] [data-card="dune"]`)
  const to = block.locator(`.database-column[data-column="${section('done', 'essay')}"]`)
  await card.scrollIntoViewIfNeeded()
  const a = await card.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down()
  await page.mouse.move(a.x + 28, a.y + 18, { steps: 3 }); await wait(80)
  await page.mouse.move(Math.min(b.x + 20, 1110), b.y + 30, { steps: 12 }); await wait(250)
  await page.mouse.up(); await wait(1000)
  const moved = pageOf('dune').values
  check(moved.kind === 'essay' && moved.status === 'done', 'a card dragged across lanes and columns changes both', [moved.status, moved.kind])
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(900)
  check(pageOf('dune').values.kind === 'novel' && pageOf('dune').values.status === 'now', 'one Undo takes back both', [pageOf('dune').values.status, pageOf('dune').values.kind])
}
const laneFold = block.locator('.database-lane .database-group-fold').first()
await tap(laneFold); await wait(300)
check(await block.locator('.database-column-head').count() === 3, 'folding the first lane keeps the heads on the next')
await tap(laneFold); await wait(300)

// None.
await layout('Table')
await openGroup(); await menu.getByLabel('Sub-group by').selectOption(''); await wait(800); await closeMenu()
check(!('subGroupBy' in firstView()) && await block.locator('.database-group-inner.is-sub').count() === 0, 'None takes the layer off')
await openGroup(); await menu.locator('label.database-menu-row', { hasText: 'Group by' }).first().locator('select').selectOption(''); await wait(800); await closeMenu()
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
