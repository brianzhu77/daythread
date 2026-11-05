// R4-1 and R4-2 in the built app, on tests/evidence/timeline/seed.ts. At 1280: every row draws, a move and an edge with one Undo, a pair's odd dates, read-only refused,
// units, Today, where it was left, a jump to a bar off-screen, No date, and a sideways scroll that leaves the page alone. At 390: the list by week, Earlier, No date, no sideways scroll.
// Usage: node tests/evidence/timeline/timeline.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/timeline/timeline.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/timeline/seed.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const firstView = () => pageOf('plans').database.views[0]
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
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const undo = async () => { await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000) }
const notices = async () => (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')

await page.goto(`${base}/pages?page=plans`); await wait(2500)
const rowsTotal = store().pages.filter(p => p.parentId === 'plans' && !p.trashedAt).length

if (wide) {
  const lane = id => block.locator(`.database-bar-lane[data-row="${id}"]`)
  const bar = id => lane(id).locator('.database-bar')
  const scroller = block.locator('.database-timeline')
  const inView = async id => { const b = await bar(id).boundingBox(), s = await scroller.boundingBox(); return b && b.x + b.width > s.x && b.x < s.x + s.width }
  const dayPx = 48
  await shot('day')
  check(await block.locator('.database-bar-lane[data-row]').count() === rowsTotal - 1 && (await block.locator('.database-undated-head').innerText()).includes('No date · 1'), 'every row is on a bar or the No date line', await block.locator('.database-bar-lane[data-row]').count())
  const w = async id => (await bar(id).boundingBox()).width
  check(Math.round(await w('trip')) === 5 * dayPx && Math.round(await w('call')) === dayPx, 'a range is as wide as its days, and a single day is one day', [await w('trip'), await w('call')])
  check((await block.locator('.database-today-line').count()) === 1 && await block.getByRole('button', { name: 'Today' }).isDisabled(), 'it opens on today')

  // A move keeps its length, one Undo; an edge changes one end.
  const dragBy = async (locator, px) => {
    const b = await locator.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 8, y, { steps: 3 }); await wait(60)
    await page.mouse.move(x + px, y, { steps: 10 }); await wait(120)
  }
  await dragBy(bar('trip'), 2 * dayPx)
  check((await lane('trip').locator('.database-bar-tip').innerText()).includes('–'), 'the dates show while it moves', await lane('trip').locator('.database-bar-tip').innerText())
  await shot('dragging')
  await page.mouse.up(); await wait(1000)
  check(pageOf('trip').values.when.start === day(3) && pageOf('trip').values.when.end === day(7), 'a move keeps its length', pageOf('trip').values.when)
  check((await notices()).includes('Moved to'), 'and says where', await notices())
  check(page.url().includes('page=plans'), 'and opens nothing')
  await undo()
  check(pageOf('trip').values.when.start === day(1) && pageOf('trip').values.when.end === day(5), 'one Undo takes it back')
  await dragBy(lane('trip').locator('.database-bar-edge.is-end'), dayPx); await page.mouse.up(); await wait(1000)
  check(pageOf('trip').values.when.start === day(1) && pageOf('trip').values.when.end === day(6), 'the right edge lengthens it', pageOf('trip').values.when)
  await undo()
  await dragBy(lane('trip').locator('.database-bar-edge.is-start'), -dayPx); await page.mouse.up(); await wait(1000)
  check(pageOf('trip').values.when.start === day(0) && pageOf('trip').values.when.end === day(5), 'the left edge too', pageOf('trip').values.when)
  await undo()
  await dragBy(lane('call').locator('.database-bar-edge.is-end'), 2 * dayPx); await page.mouse.up(); await wait(1000)
  check(pageOf('call').values.when.end === day(5), 'an edge makes a single day a range', pageOf('call').values.when)
  await undo()
  await dragBy(bar('call'), dayPx); await page.keyboard.press('Escape'); await page.mouse.up(); await wait(500)
  check(pageOf('call').values.when.start === day(3), 'Esc drops a drag with nothing changed')

  // Tapping opens its row.
  await bar('call').click(); await wait(1500)
  check(page.url().includes('page=call'), 'a click opens its row')
  await page.goBack(); await wait(1800)

  // While saving, and when a save fails.
  const isCommand = req => req.method() === 'POST' && /_serverFn|functions/.test(req.url())
  await page.route('**/*', async route => { if (isCommand(route.request())) await new Promise(res => setTimeout(res, 1500)); await route.continue() })
  const before = (await bar('trip').boundingBox()).x
  await dragBy(bar('trip'), 2 * dayPx); await page.mouse.up(); await wait(400)
  check(Math.abs((await bar('trip').boundingBox()).x - before - 2 * dayPx) <= 1, 'while saving, it shows in its new place at once')
  await wait(2200); await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(2200)
  await page.unroute('**/*')
  await page.route('**/*', route => (isCommand(route.request()) ? route.abort() : route.continue()))
  await dragBy(bar('trip'), 2 * dayPx); await page.mouse.up(); await wait(1500)
  const unsaved = block.locator('.database-unsaved')
  check(Math.abs((await bar('trip').boundingBox()).x - before - 2 * dayPx) <= 1 && (await unsaved.innerText()).includes('1 change'), 'a failed save keeps it there, with Retry', await unsaved.innerText())
  await page.unroute('**/*')
  await tap(unsaved.getByRole('button', { name: 'Retry' })); await wait(1300)
  check(pageOf('trip').values.when.start === day(3) && await unsaved.count() === 0, 'and Retry saves it')
  await undo()

  // Off-screen: a jump to it, with its name.
  const off = lane('old').locator('.database-bar-off')
  check(await off.count() === 1 && (await off.innerText()).includes('Long ago'), 'a bar off-screen has an arrow with its name', await off.innerText().catch(() => ''))
  await tap(off); await wait(900)
  check(await inView('old') && await block.getByRole('button', { name: 'Today' }).isEnabled(), 'which jumps to it, and Today is back')
  await shot('jumped')

  // Where it was left comes back, on this device. Today returns.
  await page.reload(); await wait(2500)
  check(await inView('old'), 'a reload comes back where it was left')
  await tap(block.getByRole('button', { name: 'Today' })); await wait(900)
  check(await inView('call'), 'Today returns to the current day')

  // A sideways scroll leaves the page alone.
  const pageY = await page.evaluate(() => [scrollX, scrollY])
  await scroller.hover(); await page.mouse.wheel(600, 0); await wait(300)
  check(JSON.stringify(await page.evaluate(() => [scrollX, scrollY])) === JSON.stringify(pageY), 'a sideways scroll moves only the scale')

  // Units are saved on the view, and every bar still draws.
  await tap(block.getByRole('button', { name: 'Today' })).catch(() => {}); await wait(800)
  const todayShown = async () => { const t = await block.locator('.database-today-line').boundingBox(), s = await scroller.boundingBox(); return t.x >= s.x && t.x <= s.x + s.width }
  for (const [unit, per] of [['Week', 24], ['Month', 12], ['Quarter', 4], ['Year', 1.5], ['Hours', 1152], ['Day', 48]]) {
    await block.locator('.database-timeline-unit').selectOption({ label: unit }); await wait(700)
    check(firstView().timelineUnit === unit.toLowerCase(), `${unit} is saved on the view`, firstView().timelineUnit)
    if (unit === 'Hours') { const d = new Date(), label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); check((await block.locator('.database-scale-label').allInnerTexts()).includes(label), 'Hours: changing the unit stays on the same day', await block.locator('.database-scale-label').allInnerTexts()); await tap(block.getByRole('button', { name: 'Today' })).catch(() => {}); await wait(800); check(await todayShown(), 'and Today is the time now') }
    else check(await todayShown(), `${unit}: changing the unit stays on the same day`)
    const span = await w('trip').catch(() => null)
    if (span !== null && unit !== 'Hours') check(Math.abs(span - 5 * per) <= 1 || span === 10, `${unit}: a bar is its days wide`, span)
    await shot(`unit-${unit}`)
  }

  // A pair of properties: the odd dates of §3.
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await menu.locator('label.database-menu-row', { hasText: 'Show timeline by' }).locator('select').selectOption({ label: 'From' }); await wait(600)
  await menu.getByLabel('End', { exact: true }).selectOption({ label: 'To' }); await wait(600); await closeMenu()
  check(firstView().timelineEnd === 'to', 'a second property sets the end', firstView().timelineEnd)
  await shot('pair')
  check(await inView('call'), 'choosing another property leaves the same dates on screen')
  check(await bar('call').evaluate(e => e.classList.contains('is-open-end')) && await bar('ends').evaluate(e => e.classList.contains('is-open-start')) && await bar('back').evaluate(e => e.classList.contains('is-inverted')), 'start only, end only, and backwards each read as such')
  check((await bar('back').evaluate(e => getComputedStyle(e).borderLeftWidth)) === '2px', 'a backwards row has its red edge', await bar('back').evaluate(e => [getComputedStyle(e).borderLeftWidth, getComputedStyle(e).borderLeftColor, e.className]))
  const backDates = JSON.stringify([pageOf('back').values.from, pageOf('back').values.to])
  await page.reload(); await wait(2500)
  check(JSON.stringify([pageOf('back').values.from, pageOf('back').values.to]) === backDates, 'no date is rewritten to tidy it')
  await dragBy(lane('call').locator('.database-bar-edge.is-end'), dayPx); await page.mouse.up(); await wait(1000)
  check(pageOf('call').values.to?.start === day(4) && pageOf('call').values.from.start === day(3), 'a start alone: the right edge sets End', pageOf('call').values)
  await undo()
  await dragBy(bar('back'), dayPx); await page.mouse.up(); await wait(1000)
  check(pageOf('back').values.from.start === day(3) && pageOf('back').values.to.start === day(3), 'moving a backwards row sets both, which clears it', pageOf('back').values)
  await undo()
  check(JSON.stringify([pageOf('back').values.from, pageOf('back').values.to]) === backDates, 'and one Undo brings it back as it was')

  // Read-only: Created time.
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await menu.getByLabel('End', { exact: true }).selectOption({ label: 'Same property' }); await wait(500)
  await menu.locator('label.database-menu-row', { hasText: 'Show timeline by' }).locator('select').selectOption({ label: 'Made' }); await wait(600); await closeMenu()
  const made = pageOf('call').values
  await dragBy(bar('call'), dayPx); await page.mouse.up(); await wait(500)
  check((await notices()).includes("Made can't be changed") && JSON.stringify(pageOf('call').values) === JSON.stringify(made), 'by Created time, a move is refused with a notice', await notices())
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await menu.locator('label.database-menu-row', { hasText: 'Show timeline by' }).locator('select').selectOption({ label: 'When' }); await wait(600); await closeMenu()

  // The table beside the scale.
  const toggle = block.locator('.database-timeline-toggle')
  await tap(toggle); await wait(700)
  check(firstView().timelineTable === true && await lane('trip').locator('.database-pane-name').count() === 1, 'the table shows, and that is saved on the view', firstView().timelineTable)
  const lined = async id => { const a = await lane(id).locator('.database-pane-name').boundingBox(), b = await bar(id).boundingBox(); return Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) <= 1 }
  check(await lined('trip') && await lined('call'), 'a row and its bar stay on one line')
  const tableW = (await lane('trip').locator('.database-pane').boundingBox()).width, scaleW = (await scroller.boundingBox()).width
  check(tableW <= scaleW * 0.6 + 1, 'the table leaves the bars their room', [tableW, scaleW])
  check(await block.locator('.database-pane-more').count() === 0 && await lane('trip').locator('.database-pane-columns .database-pane-cell').count() === await block.locator('.database-pane-head .database-pane-track > span').count(), 'every column is there, with none left out')
  await shot('table')
  const paneX = (await lane('trip').locator('.database-pane').boundingBox()).x, barX = (await bar('trip').boundingBox()).x
  // Over the bars: over the table, a sideways scroll moves its columns.
  await scroller.hover({ position: { x: scaleW - 30, y: 100 } }); await page.mouse.wheel(300, 0); await wait(350)
  check((await lane('trip').locator('.database-pane').boundingBox()).x === paneX && (await bar('trip').boundingBox()).x < barX, 'the table stays while the bars scroll')
  await page.mouse.wheel(-300, 0); await wait(350)
  await tap(lane('trip').locator('.database-pane-cell').filter({ hasText: /^$/ }).first()).catch(() => {}); await wait(300); await page.keyboard.press('Escape'); await wait(200)

  // Calculations at the table's foot.
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Calculate' }).click(); await wait(300)
  const calcSelects = menu.locator('select')
  await calcSelects.first().selectOption({ index: 1 }).catch(() => {}); await wait(600); await closeMenu()
  check(await block.locator('.database-bar-lane.is-foot').count() === 1, 'a calculation shows at the foot', await block.locator('.database-bar-lane.is-foot').innerText().catch(() => ''))
  await shot('foot')

  // Rows up and down, by the table's handle.
  const order = () => store().pages.filter(p => p.parentId === 'plans' && !p.trashedAt).map(p => p.id)
  const dragRow = async (id, overId, after = false) => {
    await lane(id).hover(); const h = await lane(id).locator('.database-pane-handle').boundingBox(), o = await lane(overId).boundingBox()
    await page.mouse.move(h.x + 4, h.y + 6); await page.mouse.down(); await page.mouse.move(h.x + 4, h.y + 14, { steps: 3 }); await wait(60)
    await page.mouse.move(h.x + 4, o.y + (after ? o.height - 3 : 3), { steps: 8 }); await wait(150); await page.mouse.up(); await wait(1000)
  }
  const orderBefore = order()
  await dragRow('back', 'trip')
  check(order().indexOf('back') < order().indexOf('trip'), 'a row drags up', order())
  await undo()
  check(JSON.stringify(order()) === JSON.stringify(orderBefore), 'one Undo puts it back')

  // Group: a section each, its own + New, and a drag between them.
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('button', { name: 'Group' }).click(); await wait(300)
  await menu.locator('label.database-menu-row', { hasText: 'Group by' }).first().locator('select').selectOption({ label: 'Kind' }); await wait(700); await closeMenu()
  const groupHeads = await block.locator('.database-timeline-group').allInnerTexts()
  check(groupHeads.some(t => t.includes('Work')) && groupHeads.some(t => t.includes('Home')), 'grouped, each has its section', groupHeads)
  await shot('grouped')
  check(await lane('trip').getAttribute('data-group') === 'home' && await lined('trip'), 'its rows sit under it, still on one line')
  await dragRow('trip', 'call')
  check(pageOf('trip').values.kind === 'work', 'a drag between sections changes the group', pageOf('trip').values.kind)
  await undo()
  const ids0 = new Set(store().pages.map(p => p.id))
  await block.locator('.database-group-end[data-group="work"] .database-new').click(); await wait(1200)
  const madeHere = store().pages.find(p => p.parentId === 'plans' && !ids0.has(p.id))
  check(madeHere?.values?.kind === 'work', "a section's + New takes its value", madeHere?.values)
  await page.keyboard.press('Escape'); await wait(300)
  await tap(block.locator('.database-timeline-group', { hasText: 'Home' }).locator('.database-group-fold')); await wait(250)
  check(await lane('trip').count() === 0, 'a section folds')
  await tap(block.locator('.database-timeline-group', { hasText: 'Home' }).locator('.database-group-fold')); await wait(250)
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('button', { name: 'Group' }).click(); await wait(300)
  await menu.locator('label.database-menu-row', { hasText: 'Group by' }).first().locator('select').selectOption(''); await wait(700); await closeMenu()
  await tap(toggle); await wait(700)
  check(!firstView().timelineTable && await lane('trip').locator('.database-pane-name').count() === 0, 'and hides again', firstView().timelineTable)

  // No date: a click on its lane gives it a day, and `+` on the scale makes a row with one.
  await tap(block.locator('.database-undated-head')); await wait(300)
  const noneLane = lane('none')
  check((await noneLane.boundingBox()).y > (await block.locator('.database-undated-head').boundingBox()).y, 'its rows open under the No date line')
  await shot('undated')
  const box = await noneLane.boundingBox()
  await tap(block.getByRole('button', { name: 'Today' })).catch(() => {}); await wait(800)
  const s = await scroller.boundingBox(), y = (await noneLane.boundingBox()).y + 18
  await page.mouse.move(s.x + s.width / 2, y); await wait(120)
  check(await noneLane.locator('.database-bar.is-ghost').count() === 1, 'a row with no dates shows a ghost bar on hover')
  await page.mouse.click(s.x + s.width / 2, y); await wait(1000)
  check(Boolean(pageOf('none').values?.when?.start), 'and a click sets its date', pageOf('none').values)
  await undo()
  await page.mouse.move(s.x + s.width / 2, y); await page.mouse.down(); await page.mouse.move(s.x + s.width / 2 + 96, y, { steps: 6 }); await page.mouse.up(); await wait(1000)
  check(Boolean(pageOf('none').values?.when?.end), 'and a drag sets a range', pageOf('none').values)
  await undo()
  const idsBefore = new Set(store().pages.map(p => p.id))
  const head = await block.locator('.database-scale').boundingBox()
  await page.mouse.move(s.x + s.width / 2, head.y + 10); await wait(120)
  await block.locator('.database-scale-add').click(); await wait(1200)
  const made2 = store().pages.find(p => p.parentId === 'plans' && !idsBefore.has(p.id))
  check(Boolean(made2?.values?.when?.start), '+ on the scale makes a row with that date', made2?.values)
} else {
  await shot('list')
  const heads = await block.locator('.database-week-head').allInnerTexts()
  check(heads[0] === 'This week', 'the list starts at this week', heads)
  const dates = await block.locator('.database-week-row[data-row="run"] .database-week-dates').innerText()
  check(dates.includes('–') && await block.locator('.database-week').first().locator('[data-row="run"]').count() === 1, 'a row still running sits in this week, with its dates in full', dates)
  const earlier = block.locator('.database-weeks-earlier')
  check((await earlier.innerText()).includes('Earlier · 1') && await block.locator('[data-row="old"]').count() === 0, "what's over folds into Earlier", await earlier.innerText())
  await tap(earlier); await wait(200)
  check(await block.locator('[data-row="old"]').count() === 1, 'and opens')
  const none = block.locator('.database-undated .database-undated-head')
  check((await none.innerText()).includes('No date · 1'), 'No date is at the end')
  await tap(none); await wait(200)
  const listed = await block.locator('.database-week-row').count()
  check(listed === rowsTotal, 'every row is listed, counting Earlier and No date', [listed, rowsTotal])
  check(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll')
  await shot('open')
  await tap(block.locator('.database-week-row[data-row="call"] button')); await wait(1500)
  check(page.url().includes('page=call'), 'tapping opens its row')
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
