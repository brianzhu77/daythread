// Board and Group (R2-12, R2-13, R2-14) in the built app, on a fresh store from seed-board.ts each run. At 1280: a grouped
// table (fold, + New, cap, hide, Multi-select, keys, dragging a row across groups) and a board (made from + Add view,
// dragging, its place, Undo, a failed save, + New, keys, a deleted property). At 390: what doesn't need a real finger.
// Long-press and swipe are in the native run.
// Usage: node tests/evidence/board/board.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/board/board.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const row = id => store().pages.find(p => p.id === id)
const db = () => row('list').database
const shownView = () => db().views.at(-1)
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(350) }
const openMenu = async () => { await clearNotices(); await tap(block.locator('.database-more-button')); await wait(300) }
const groupNames = () => block.locator('.database-group-fold').allInnerTexts()
const setGroup = async (label, by) => {
  await openMenu(); await tap(menu.getByRole('button', { name: 'Group' })); await wait(200)
  if (label === null) await menu.getByLabel('Group by').selectOption(''); else await menu.getByLabel('Group by').selectOption({ label })
  await wait(900)
  if (by) { await menu.getByLabel('By', { exact: true }).selectOption(by); await wait(800) }
  await closeMenu()
}
const cardsIn = name => page.locator(`.database-column:has(.database-column-head:has-text("${name}")) .database-card-title`).allInnerTexts()
const drag = async (from, to, at = 0.5) => {
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(100)
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 }); await wait(80)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * at, { steps: 8 }); await wait(150)
  return async () => { await page.mouse.up(); await wait(900) }
}
const card = name => page.locator('.database-card', { has: page.locator('.database-card-title', { hasText: new RegExp(`^${name}$`) }) }).first()
const col = name => page.locator(`.database-column:has(.database-column-head:has-text("${name}"))`)

await page.goto(`${base}/pages?page=books`); await wait(2500)

// ---- the grouped table
await setGroup('Kind')
check((await groupNames()).map(s => s.replace(/\s/g, '')).join() === 'Novel·2,Essay·31,Novalue·1', 'groups in option order, no value last, with counts', await groupNames())
check(db().views[0].groupBy === 'kind', 'saved on the view')
await shot('grouped')
const titles = () => block.locator('.database-title-cell').allInnerTexts()
check((await titles()).length === 2 + 25 + 1, 'each group follows the row cap', (await titles()).length)
await tap(block.locator('.database-group-foot[data-group="essay"] .database-more')); await wait(300)
check((await titles()).length === 2 + 31 + 1, 'Show 25 more under the group')
// Fold: this device only, no save.
const rev = store().revision
await tap(block.locator('.database-group-fold').nth(1)); await wait(300)
check((await titles()).length === 2 + 1 && store().revision === rev, 'a fold hides its rows and saves nothing')
await page.reload(); await wait(2500)
check((await titles()).length === 2 + 1, 'a fold stays after a reload')
await tap(block.locator('.database-group-fold').nth(1)); await wait(300)
// + New under a group.
await tap(block.locator('.database-group-foot[data-group="novel"] .database-new')); await wait(1200)
if (wide) {
  await page.keyboard.type('Added under Novel'); await page.keyboard.press('Enter'); await wait(1000)
  const added = store().pages.find(p => p.title === 'Added under Novel')
  check(added?.values?.kind === 'novel', '+ New under a group starts with its value', added?.values)
} else {
  const added = store().pages.filter(p => p.parentId === 'list').at(-1)
  check(added?.values?.kind === 'novel' && page.url().includes(added.id), '+ New under a group opens the row, with its value', added?.values)
  await page.goBack(); await wait(1500)
}
// Hide a group, and bring it back from its line.
await openMenu(); await tap(menu.getByRole('button', { name: 'Group' })); await wait(200)
await menu.getByLabel('Show Essay').click(); await wait(900); await closeMenu()
const line = block.locator('.database-hidden-groups')
check(/Hidden: Essay \(31\)/.test(await line.innerText()), 'a hidden group is listed with its count', await line.innerText())
await shot('hidden')
await tap(line.getByRole('button')); await wait(900)
check(await line.count() === 0 && !db().views[0].hiddenGroups, 'a tap shows it again')
// Multi-select: a row in each group; a cell opens under the one tapped.
await setGroup('Tags')
const emmas = block.locator('tr.database-row[data-row="emma"]')
check(await emmas.count() === 2, 'a Multi-select row is in each of its groups')
if (wide) {
  await emmas.nth(1).locator('td.is-number .database-cell, td.is-select .database-cell').first().click(); await wait(900)
  const cell = await emmas.nth(1).locator('td.is-select').boundingBox(), pops = await page.locator('.property-popover').evaluateAll(l => l.map(e => { const r = e.getBoundingClientRect(); return [r.y, r.height, e.getAttribute('aria-label')] }))
  const pop = await page.locator('.property-popover').last().boundingBox()
  check(pop && Math.abs(pop.y - (cell.y + cell.height)) < 60, 'its editor opens under the row tapped', { cell: cell?.y, pops, scroll: await page.evaluate(() => scrollY) })
  await shot('multi-editor')
  await page.keyboard.press('Escape'); await wait(300)
}
// Date: month by default; week and day from the sheet.
await setGroup('Due')
check((await groupNames()).map(s => s.replace(/·.*/, '').trim()).join() === 'October 2026,November 2026,No value', 'dates group by month', await groupNames())
await setGroup('Due', 'day')
check((await groupNames())[0].startsWith('Oct 25, 2026'), 'and by day', await groupNames())
// Filter and group disagree: told so.
await setGroup('Status')
const plain = l => l.map(s => s.trim().replace(/\s+/g, ' ').replace(/^[○◐●] /, '').replace(/ · \d+$/, ''))
check(plain(await groupNames()).join() === 'To read,Reading,Finished', 'status groups, To do first, no group for none', await groupNames())
if (wide) {
  // Keys across a group header stay in the block.
  await block.locator('tr.database-row[data-group="todo"] .database-title-cell').last().focus()
  await page.keyboard.press('ArrowDown'); await wait(100)
  const focused = await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.row)
  check(focused === 'dune', 'an arrow crosses a group header', focused)
  // Dragging a row to another group: value and Undo.
  const handle = block.locator('tr.database-row[data-row="dune"]')
  await handle.hover(); const h = block.locator('tr.database-row[data-row="dune"] .database-row-handle')
  const drop = await drag(h, block.locator('tr.database-group-foot[data-group="done"]'), 0.2)
  check(await block.locator('tr.database-group-foot[data-group="done"].is-drop-end').count() === 1, 'the end of a group shows the drop line')
  await drop()
  check(row('dune').values.status === 'done', 'a row dragged to another group takes its value', row('dune').values.status)
  check(await page.getByText('Moved to Finished').count() >= 1, 'and says so')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
  check(row('dune').values.status === 'now', 'Undo puts it back')
}
await setGroup(null)
check(await groupNames().then(n => n.length) === 0 && await block.locator('.database-title-cell').count() > 0, 'None takes the groups away')

// ---- a board, made from + Add view
await clearNotices(); await tap(block.locator('.database-view-name')); await wait(300)
await tap(menu.getByRole('menuitem', { name: '+ Add view' })); await wait(200)
await tap(menu.getByRole('menuitem', { name: 'Board' })); await wait(200)
check((await menu.getByRole('menuitem').allInnerTexts()).map(s => s.split('\n')[0]).join() === 'Status,Kind,Owned,+ New Status property', 'asks what makes the columns', await menu.getByRole('menuitem').allInnerTexts())
await shot('ask')
await tap(menu.getByRole('menuitem', { name: /^Status/ })); await wait(1000)
const named = await menu.getByLabel('View name').inputValue().catch(() => '')
check(named === 'Board', 'named after its type, ready to rename', named)
await page.keyboard.press('Enter'); await wait(400); await closeMenu()
check(shownView().layout === 'board' && shownView().groupBy === 'status' && shownView().columns.length === 0, 'stored as a board', shownView())
check(await page.locator('.database-column:not(.is-add)').count() === 3, 'one column per option')
check((await page.locator('.database-column-head').allInnerTexts()).map(s => s.replace(/\s/g, '').replace(/^[○◐●]/, '')).join() === 'Toread·3,Reading·1,Finished·31', 'names and counts', await page.locator('.database-column-head').allInnerTexts())
await shot('board')
check((await cardsIn('Finished')).length === 25, 'a long column follows the cap', (await cardsIn('Finished')).length)
await tap(col('Finished').locator('.database-more')); await wait(300)
check((await cardsIn('Finished')).length === 31, 'Show 25 more')
if (!wide) {
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.database-board')).scrollSnapType.includes('x')), 'the phone snaps')
  check(await page.evaluate(() => document.querySelector('.database-column').offsetWidth) === 300, 'columns are 300 px')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the page itself has no sideways scroll')
  // A tap on a card opens its row.
  await tap(card('Dune')); await wait(1500)
  check(page.url().includes('page=dune'), 'a tap opens the row', page.url())
  await page.goBack(); await wait(1500)
  await tap(col('Reading').locator('.database-new')); await wait(1800)
  const added = store().pages.filter(p => p.parentId === 'list').at(-1)
  check(added.values?.status === 'now' && page.url().includes(added.id), '+ New in a column opens the row, with its value', added.values)
} else {
  // Dragging: a place in another column, in one Undo.
  const order = () => store().pages.filter(p => p.parentId === 'list').map(p => p.id)
  const release = await drag(card('Emma'), card('Dune'), 0.2)
  await shot('dragging')
  check(await page.locator('.database-card.is-ghost').count() === 1 && await col('Reading').locator('.database-card.is-drop-before').count() === 1, 'a floating card and a line where it lands')
  await release()
  check(row('emma').values.status === 'now', 'a card takes its new column\'s value')
  check(order().indexOf('emma') < order().indexOf('dune'), 'and the place it was dropped')
  check((await cardsIn('Reading')).join() === 'Emma,Dune', 'shown there', await cardsIn('Reading'))
  check(!page.url().includes('page=emma'), 'a drag doesn\'t open the row')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
  check(row('emma').values.status === 'todo' && order().indexOf('emma') === order().indexOf('dune') + 1, 'one Undo takes back both', order().slice(0, 3))
  // Within a column, a place only.
  await clearNotices()
  const within = await drag(card('No kind yet'), card('Emma'), 0.2); await within()
  check((await cardsIn('To read')).slice(0, 2).join() === 'No kind yet,Emma' && row('blank').values.status === 'todo', 'within a column it only moves', await cardsIn('To read'))
  // Esc cancels.
  const esc = await drag(card('Dune'), col('Finished'), 0.1); await page.keyboard.press('Escape'); await wait(200); await esc()
  check(row('dune').values.status === 'now', 'Esc cancels a drag')
  // A failed save stays shown, in its new column; Retry sends it.
  await clearNotices()
  await page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
  const fail = await drag(card('Dune'), col('Finished'), 0.1); await fail(); await wait(1500)
  check((await cardsIn('Finished')).includes('Dune') && row('dune').values.status === 'now', 'a failed save stays shown where he dropped it', { reading: await cardsIn('Reading'), stored: row('dune').values.status, notices: await page.locator('[data-slot="toast"]').allInnerTexts() })
  check(await page.locator('.database-unsaved').count() === 1 && await card('Dune').locator('.database-card-unsaved').count() === 1, 'and says it isn\'t saved')
  await shot('failed')
  await page.unroute('**/_serverFn/**')
  await tap(page.locator('.database-unsaved').getByRole('button', { name: 'Retry' })); await wait(1200)
  check(row('dune').values.status === 'done' && await page.locator('.database-unsaved').count() === 0, 'Retry saves it')
  // Keys.
  await clearNotices()
  await card('Dune').locator('.database-card-title').focus()
  await page.keyboard.press('Shift+ArrowLeft'); await wait(1100)
  check(row('dune').values.status === 'now', 'Shift-arrow moves a card to the next column', row('dune').values.status)
  check(await page.evaluate(() => document.activeElement?.closest('[data-card]')?.dataset.card) === 'dune', 'focus stays on it')
  await page.keyboard.press('ControlOrMeta+z'); await wait(1100)
  check(row('dune').values.status === 'done', '⌘Z undoes it')
  await card('Emma').locator('.database-card-title').focus()
  await page.keyboard.press('ArrowRight'); await wait(100)
  check(await page.evaluate(() => document.activeElement?.closest('[data-column]')?.dataset.column) !== 'todo', 'arrows move between columns')
  await page.keyboard.press('Escape'); await wait(200)
  // + New at a column's foot: its value, and its name opens to be typed.
  await tap(col('Reading').locator('.database-new')); await wait(1000)
  await page.keyboard.type('A new card'); await page.keyboard.press('Enter'); await wait(1000)
  const made = store().pages.find(p => p.title === 'A new card')
  check(made?.values?.status === 'now' && (await cardsIn('Reading')).includes('A new card'), '+ New in a column sets its value', made?.values)
  // A filter that disagrees with the column.
  await openMenu(); await tap(menu.getByRole('button', { name: 'Filter' })); await tap(menu.getByText('+ Add filter')); await wait(700)
  await menu.getByLabel('Property').last().selectOption({ label: 'Status' }); await wait(700)
  await menu.getByLabel('Reading').last().click(); await wait(900); await closeMenu()
  await tap(col('To read').locator('.database-new')); await wait(1000)
  check(await page.getByText("Added · hidden by this view's filter").count() >= 1, 'a new row the filter hides says so (§7.4)')
  await clearNotices()
  const hidden = await drag(card('A new card'), col('Finished'), 0.1); await hidden()
  check(await page.getByText("Moved to Finished · hidden by this view's filter").count() >= 1, 'a card the filter then hides says so')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(900)
  await openMenu(); await tap(menu.getByRole('button', { name: 'Filter' })); await tap(menu.getByLabel('Remove filter').first()); await wait(800); await closeMenu()
  // + Add column.
  await page.locator('.database-board').evaluate(el => { el.scrollLeft = el.scrollWidth }); await wait(200)
  await tap(page.locator('.database-column.is-add .database-new')); await page.locator('.database-column-name').fill('Paused'); await page.keyboard.press('Enter'); await wait(1000)
  check(await col('Paused').count() === 1 && db().properties[0].options.some(o => o.name === 'Paused' && o.group === 'todo'), '+ Add column makes an option, at the end of To do')
  // A board's property deleted: all its rows in one column, and it asks; Undo brings the columns back.
  await openMenu(); await tap(menu.getByRole('menuitem', { name: /Properties/ })); await tap(menu.getByRole('button', { name: /^Status/ })); await wait(200)
  await tap(menu.getByRole('menuitem', { name: 'Delete property' })); await wait(1000); await closeMenu()
  check(await page.getByText('Choose what makes the columns').count() === 1 && await page.locator('.database-column').count() === 1, 'its property deleted, one column and a question')
  check(await page.locator('.database-card').count() === 25 && (await page.locator('.database-more').count()) === 1, 'no row vanishes: the capped column offers the rest')
  await shot('no-group')
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000)
  check(await page.locator('.database-column').count() >= 3, 'Undo brings the columns back')
  // The No value column clears the value.
  await openMenu(); await tap(menu.getByRole('button', { name: 'Group' })); await menu.getByLabel('Group by').selectOption({ label: 'Kind' }); await wait(900); await closeMenu()
  check(await col('No value').count() === 1, 'rows with no value have their own column')
  const clear = await drag(card('Dune'), col('No value'), 0.1); await clear()
  check(row('dune').values.kind === undefined, 'dropped there, the value is cleared')
  // Back from a row, the card is tinted where he left it.
  await clearNotices(); await card('Dune').click(); await wait(1500); await page.goBack(); await wait(700)
  check(await page.locator('.database-card.is-returned').count() === 1, 'back from a row, its card is tinted')
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
