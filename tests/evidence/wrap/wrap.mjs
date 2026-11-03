// R3-14 Wrap per property in the built app, on a fresh store: one line at rest, a column, Name, Wrap all; the row grows, all of a tall
// cell still taps, Name stays pinned, sideways scroll and the page's place hold; cards; a reload.
// Usage: node tests/evidence/wrap/wrap.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/wrap/wrap.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280', rowHeight = wide ? 36 : 44
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/wrap/seed-wrap.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const firstView = () => store().pages.find(p => p.id === 'list').database.views[0]
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
const row = id => block.locator(`tr.database-row[data-row="${id}"]`)
const height = async id => Math.round((await row(id).boundingBox()).height)
const setColumn = async name => { await openPanel('Properties'); await tap(menu.getByRole('button', { name: new RegExp(`^${name}`) })); await wait(300); await tap(menu.getByLabel('Wrap in this view')); await wait(800); await closeMenu() }

await page.goto(`${base}/pages?page=books`); await wait(2500)
check(await height('dune') <= rowHeight + 1 && await block.locator('table.has-wrap').count() === 0, 'one line at rest', await height('dune'))
const nameAtRest = await row('emma').locator('td.is-title').evaluate(e => ({ width: e.getBoundingClientRect().width, cut: e.querySelector('.database-title-cell').scrollWidth > e.querySelector('.database-title-cell').clientWidth }))
check(nameAtRest.width === (wide ? 240 : 150) && nameAtRest.cut, "a long value doesn't stretch its column: it ends in an ellipsis", nameAtRest)
await shot('rest')

// Sideways place, before the switch.
const scroller = block.locator('.database-scroll')
await scroller.evaluate(e => { e.scrollLeft = 60 }); await wait(150)
await setColumn('Note')
check(firstView().columns.find(c => c.id === 'note').wrap === true, 'saved on the view')
check(await height('dune') > rowHeight + 10, 'the row grows', await height('dune'))
check(await height('ubik') <= rowHeight + 1, 'only the row that needs it', await height('ubik'))
check(await scroller.evaluate(e => e.scrollLeft) === 60, 'sideways scroll holds', await scroller.evaluate(e => e.scrollLeft))
await scroller.evaluate(e => { e.scrollLeft = 0 }); await wait(150)
const words = await row('dune').locator('td.is-text .cell-text').evaluate(e => ({ text: e.innerText, fits: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1 }))
check(words.fits && words.text.includes('\n'), 'all of it shows, its own line break too', words)
await shot('column')

// A tall row: everything starts at the top, and all of a tall cell taps.
const geometry = await page.evaluate(() => {
  const tr = document.querySelector('tr.database-row[data-row="dune"]'), r = tr.getBoundingClientRect(), line = el => { const g = document.createRange(); g.selectNodeContents(el); return g.getClientRects()[0] }
  const name = line(tr.querySelector('.database-title-cell span')), note = line(tr.querySelector('td.is-text .cell-text')), pages = line(tr.querySelector('td.is-number .cell-number'))
  const kind = tr.querySelector('td.is-select .database-cell').getBoundingClientRect()
  return { name: name.top - r.top, note: note.top - r.top, pages: pages.top - r.top, kindFill: Math.abs(kind.height - r.height), height: r.height }
})
check(Math.abs(geometry.name - geometry.note) < 1.5 && Math.abs(geometry.pages - geometry.note) < 1.5, 'first lines share a top', geometry)
check(geometry.kindFill <= 3, 'a short cell fills the tall row', geometry)
if (wide) {
  await row('dune').hover(); await wait(150)
  const gutter = await page.evaluate(() => { const tr = document.querySelector('tr.database-row[data-row="dune"]').getBoundingClientRect(), pick = document.querySelector('tr.database-row[data-row="dune"] .database-row-pick').getBoundingClientRect(); return pick.top + pick.height / 2 - tr.top })
  check(Math.abs(gutter - 18) <= 3, 'the handle and tick sit by the first line', gutter)
}
const kindCell = row('dune').locator('td.is-select .database-cell')
await scroller.evaluate(e => { e.scrollLeft = 180 }); await wait(200)
const box = await kindCell.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3)
if (wide) await page.mouse.click(box.x + box.width / 2, box.y + box.height - 3); else await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 3)
await wait(400)
check(await page.locator('.property-field, [role="listbox"], [role="dialog"]').count() > 0, 'its bottom edge opens the editor too')
await page.keyboard.press('Escape'); await wait(300); if (!wide && await page.locator('.property-sheet-scrim').count()) { await page.locator('.property-sheet-scrim').click({ position: { x: 5, y: 5 } }); await wait(300) }

// Editing a wrapped cell: it grows, and the page stays where it was.
const scrollers = `(() => [document.scrollingElement, ...[...document.querySelectorAll('*')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && !e.closest('.database-scroll'))].filter(e => e && e.scrollHeight > e.clientHeight + 40))()`
const scrollTop = () => page.evaluate(`${scrollers}.reduce((n, e) => n + e.scrollTop, 0)`)
await page.evaluate(`${scrollers}.forEach(e => { e.scrollTop = 120 })`); await wait(250)
await scroller.evaluate(e => { e.scrollLeft = 0 }); await wait(150)
const before = await scrollTop(), was = await height('ubik')
await tap(row('ubik').locator('td.is-text button.database-cell')); await wait(350)
await page.locator('.property-field').fill('Ubik now has a note long enough to run on to a second line in this column, and maybe a third'); await wait(100)
if (wide) await page.keyboard.press('Enter'); else await page.getByText('Done').last().tap()
await wait(1000)
check(await height('ubik') > was, 'editing grows the row', [was, await height('ubik')])
check(before > 0 && Math.abs(await scrollTop() - before) <= 2, 'and the page keeps its place', [before, await scrollTop()])
await page.evaluate(`${scrollers}.forEach(e => { e.scrollTop = 0 })`); await wait(200)

// What can't wrap doesn't offer it.
await openPanel('Properties'); await tap(menu.getByRole('button', { name: /^Pages/ })); await wait(300)
check(await menu.getByLabel('Wrap in this view').count() === 0, 'a number has no switch')
await closeMenu()

// Name, pinned.
const emmaBefore = await height('emma')
await openPanel('Properties'); await tap(menu.getByLabel('Wrap Name')); await wait(800); await closeMenu()
check(firstView().wrapName === true && await height('emma') > emmaBefore, 'Name wraps, and its row grows', [emmaBefore, await height('emma')])
const nameLeft = () => row('emma').locator('td.is-title').evaluate(e => e.getBoundingClientRect().left)
const leftAtStart = await nameLeft()
await scroller.evaluate(e => { e.scrollLeft = 200 }); await wait(250)
const pinned = await page.evaluate(() => { const td = document.querySelector('tr.database-row[data-row="emma"] td.is-title').getBoundingClientRect(), tr = document.querySelector('tr.database-row[data-row="emma"]').getBoundingClientRect(), s = document.querySelector('.database-scroll'); return { scrolled: s.scrollLeft, tall: Math.abs(td.height - tr.height) } })
check(pinned.scrolled === 200 && await nameLeft() === leftAtStart && pinned.tall <= 1, 'Name stays pinned at its full height', pinned)
await shot('name-pinned')
await scroller.evaluate(e => { e.scrollLeft = 0 }); await wait(150)

// Wrap all, a reload, and back.
await openPanel('Layout'); await tap(menu.getByLabel('Wrap all')); await wait(800); await closeMenu()
check(firstView().columns.every(c => c.wrap) && firstView().wrapName === true, 'Wrap all sets every column', firstView().columns.filter(c => !c.wrap))
check(await block.locator('tr.database-row td.is-number.is-wrapped').count() === 0 && await block.locator('tr.database-row td.is-checkbox.is-wrapped').count() === 0, 'but a number and a tick draw as before')
await page.reload(); await wait(2500)
check(await block.locator('table.has-wrap').count() === 1 && await height('emma') > rowHeight + 1, 'it stays after a reload', await height('emma'))
await shot('all')
await openPanel('Layout')
check(await menu.getByLabel('Wrap all').isChecked(), 'and reads as on')

// Cards: Gallery and Board; List stays one line.
await tap(menu.getByRole('menuitemradio', { name: 'Gallery' })); await wait(900); await closeMenu()
const card = await page.locator('.database-gallery-card[data-row="dune"] .database-card-value.is-wrapped').first().evaluate(e => ({ text: e.innerText, fits: e.scrollWidth <= e.clientWidth + 1 }))
check(card.fits && card.text.includes('with more words after it'), 'a gallery card wraps', card)
await shot('gallery')
await openPanel('Layout'); await tap(menu.getByRole('menuitemradio', { name: 'List' })); await wait(900); await closeMenu()
check(await page.locator('.database-list .is-wrapped').count() === 0, "a list's values stay on their line")
const listRow = page.locator('.database-list-row[data-row="emma"]')
const wrappedHeight = (await listRow.boundingBox()).height
check(await page.locator('.database-list.wraps-name').count() === 1 && wrappedHeight > rowHeight + 1, 'a list wraps Name', wrappedHeight)
const listGeometry = await listRow.evaluate(row => { const t = document.createRange(); t.selectNodeContents(row.querySelector('.database-list-title')); const v = row.querySelector('.database-list-value'), r = row.getBoundingClientRect(); return { fits: row.querySelector('.database-list-title').scrollWidth <= row.querySelector('.database-list-title').clientWidth + 1, overRow: t.getBoundingClientRect().bottom <= r.bottom + 1, valueTop: v ? v.getBoundingClientRect().top - r.top : null } })
check(listGeometry.fits && listGeometry.overRow, 'all of the title shows', listGeometry)
await shot('list-name')
await openPanel('Properties'); await tap(menu.getByLabel('Wrap Name')); await wait(800); await closeMenu()
const cutAgain = await listRow.locator('.database-list-title').evaluate(e => e.scrollWidth > e.clientWidth)
check(await page.locator('.database-list.wraps-name').count() === 0 && (await listRow.boundingBox()).height < wrappedHeight && cutAgain, 'and can stop: the title is cut again', [wrappedHeight, (await listRow.boundingBox()).height, cutAgain])
await openPanel('Properties'); await tap(menu.getByLabel('Wrap Name')); await wait(800); await closeMenu()
await openPanel('Layout'); check(await menu.getByLabel('Wrap all').count() === 0, 'and offers no Wrap'); await tap(menu.getByRole('menuitemradio', { name: 'Table' })); await wait(900); await closeMenu()
await openPanel('Layout'); await tap(menu.getByLabel('Wrap all')); await wait(800); await closeMenu()
check(firstView().columns.every(c => !c.wrap) && !('wrapName' in firstView()) && await height('dune') <= rowHeight + 1, 'off goes back to one line', await height('dune'))
check(await block.locator('table.has-wrap').count() === 0, 'and to middle-aligned cells')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
