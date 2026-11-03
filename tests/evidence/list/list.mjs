// R3-2 List in the built app, on a fresh store from board/seed-board.ts: made from + Add view, up to 3 properties on a line (under
// the title on the phone), opening a row, a tick, + New, the cap, Group, dragging, a failed save, keys and the clipboard.
// Usage: node tests/evidence/list/list.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/list/list.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
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
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(350) }
const openMenu = async () => { await clearNotices(); await tap(block.locator('.database-more-button')); await wait(300) }
const line = id => block.locator(`.database-list-row[data-row="${id}"]`).first()
const titles = () => block.locator('.database-list-title').allInnerTexts()
const setGroup = async label => { await openMenu(); await tap(menu.getByRole('button', { name: 'Group' })); await wait(200); if (label === null) await menu.getByLabel('Group by').selectOption(''); else await menu.getByLabel('Group by').selectOption({ label }); await wait(900); await closeMenu() }

await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(block.locator('.database-view-name')); await wait(300)
await tap(menu.getByRole('menuitem', { name: '+ Add view' })); await wait(200)
await tap(menu.getByRole('menuitem', { name: 'List' })); await wait(1000)
check(await menu.getByLabel('View name').inputValue().catch(() => '') === 'List', 'named after its type, ready to rename')
await page.keyboard.press('Enter'); await wait(400); await closeMenu()
check(view().layout === 'list', 'stored as a list', view().layout)
check((await titles()).length === 25, 'follows the row cap', (await titles()).length)
await shot('list')
await page.evaluate(() => window.scrollTo(0, 0))
// One line at 1280; under the title on the phone; 3 properties at most.
const geo = await line('dune').evaluate(l => { const t = l.querySelector('.database-list-title').getBoundingClientRect(), v = l.querySelector('.database-list-values').getBoundingClientRect(); return { titleBottom: t.bottom, valuesTop: v.top, valuesRight: v.right, right: l.getBoundingClientRect().right, h: l.getBoundingClientRect().height, count: l.querySelectorAll('.database-list-value, .database-list-check').length } })
check(geo.count === 3, 'up to 3 properties', geo.count)
check(wide ? geo.valuesTop < geo.titleBottom && Math.abs(geo.valuesRight - geo.right) <= 9 : geo.valuesTop >= geo.titleBottom - 1, wide ? 'on one line, on the right' : 'under the title', geo)
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
const edge = await page.evaluate(() => { const w = e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().left }; return { title: w(document.querySelector('.database-list-title')), add: w(document.querySelector('.database-table-wrap > .database-new')) } })
check(Math.abs(edge.title - edge.add) <= 1, "a row's words on + New's", edge)
// Opening a row; Back tints it.
await tap(line('dune').locator('.database-list-title')); await wait(1500)
check(page.url().includes('page=dune'), 'a tap opens the row', page.url())
await page.goBack(); await wait(800)
check(await block.locator('.database-list-row.is-returned').count() === 1, 'back from a row, it is tinted')
await wait(1200)
await tap(block.locator(':scope .database-more').last()); await wait(300)
check((await titles()).length === 34, 'Show 25 more', (await titles()).length)
// A tick in place: Properties, so Owned is one of the 3.
await openMenu(); await tap(menu.getByRole('menuitem', { name: /Properties/ })); await wait(200)
await menu.getByLabel('Show Tags').click(); await wait(600); await menu.getByLabel('Show Pages').click(); await wait(600); await menu.getByLabel('Show Due').click(); await wait(800); await closeMenu()
const box = line('emma').locator('.property-checkbox')
check(await box.count() === 1, 'a Checkbox property shows')
await tap(box); await wait(1100)
check(row('emma').values.owned === true && page.url().includes('page=books'), 'a tick saves in place, and opens nothing')
// A new row: its name opens at 1280; its page on the phone.
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
if (wide) { await page.keyboard.type('Typed on a list'); await page.keyboard.press('Enter'); await wait(1000); check(store().pages.some(p => p.title === 'Typed on a list' && p.parentId === 'list'), '+ New types its name') }
else { const made = store().pages.filter(p => p.parentId === 'list').at(-1); check(page.url().includes(made.id), '+ New opens the row'); await page.goBack(); await wait(1500) }
// Group, fold, + New under a group, hidden.
await setGroup('Kind')
const folds = () => block.locator('.database-group-fold').allInnerTexts()
check((await folds()).map(s => s.replace(/\s+/g, ' ').trim().replace(/ · \d+$/, '')).join() === 'Novel,Essay,No value', 'groups as in a table', await folds())
await shot('grouped')
const rev = store().revision
await tap(block.locator('.database-group-fold').nth(1)); await wait(300)
check((await titles()).filter(t => t.startsWith('Finished')).length === 0 && store().revision === rev, 'a fold hides its rows and saves nothing')
await tap(block.locator('.database-group-fold').nth(1)); await wait(300)
await tap(block.locator('.database-list-foot[data-group="novel"] .database-new')); await wait(1300)
if (wide) { await page.keyboard.type('In Novel'); await page.keyboard.press('Enter'); await wait(1000) } else { await page.goBack(); await wait(1500) }
const added = store().pages.filter(p => p.parentId === 'list').at(-1)
check(added.values?.kind === 'novel', '+ New under a group starts with its value', added.values)
await openMenu(); await tap(menu.getByRole('button', { name: 'Group' })); await wait(200); await menu.getByLabel('Show Essay').click(); await wait(800); await closeMenu()
check(/Hidden: Essay/.test(await block.locator('.database-hidden-groups').innerText()), 'a hidden group is listed')
await tap(block.locator('.database-hidden-groups').getByRole('button')); await wait(800)
if (wide) {
  // Dragging: to another group, value and Undo; within one, a place.
  const dragTo = async (handle, to, at = 0.2) => { await page.evaluate(() => window.scrollTo(0, 0)); await wait(100); await line('dune').hover(); const a = await handle.boundingBox(), b = await to.boundingBox(); await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + b.height * at, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(1000) }
  await clearNotices()
  await dragTo(line('dune').locator('.database-list-handle'), block.locator('.database-list-foot[data-group="essay"]').first())
  check(row('dune').values.kind === 'essay', 'a row dragged to another group takes its value', row('dune').values.kind)
  check(await page.getByText('Moved to Essay').count() >= 1, 'and says so')
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  check(row('dune').values.kind === 'novel', 'Undo puts it back')
  // Keys and the clipboard.
  const doc = () => row('books').document, doc0 = doc()
  await line('dune').locator('.database-list-title').focus(); await page.keyboard.press('ArrowDown'); await wait(100)
  check(await page.evaluate(() => document.activeElement?.closest('[data-row]')?.dataset.row) === 'emma', 'an arrow moves between rows')
  await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
  check(await page.evaluate(() => document.activeElement?.classList.contains('database-list-title')), 'Enter on the selected block comes to its first row')
  for (const key of ['Backspace', 'Delete', 'ControlOrMeta+x', 'ControlOrMeta+v', '/', 'z', 'ControlOrMeta+a']) { await line('dune').locator('.database-list-title').focus(); await page.keyboard.press(key); await wait(350) }
  check(doc() === doc0 && await block.locator('.database-list').count() === 1 && !row('dune').trashedAt, 'keys and the clipboard on a row leave the page and the block alone')
  // A failed tick stays shown and says so; Retry saves.
  await setGroup(null)
  await clearNotices()
  await page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
  await line('emma').locator('.property-checkbox').click(); await wait(1500)
  check(await page.locator('.database-unsaved').count() === 1 && await line('emma').locator('.database-card-unsaved').count() === 1, 'a failed save says so on the row')
  await page.unroute('**/_serverFn/**')
  await page.locator('.database-unsaved').getByRole('button', { name: 'Retry' }).click(); await wait(1200)
  check(row('emma').values.owned === undefined, 'Retry saves it')
  // Sorted: no handle.
  await openMenu(); await menu.getByRole('button', { name: 'Sort' }).click(); await menu.getByText('+ Add sort').click(); await wait(800); await closeMenu()
  check(await block.locator('.database-list-handle').count() === 0, 'sorted, rows have no handle')
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
