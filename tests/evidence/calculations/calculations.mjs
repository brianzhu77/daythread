// R3-8 Column calculations in the built app, on a fresh store: nothing at rest, set from the menu, the filter and groups, a linked view's
// own, a reload, a foot cell back to the menu, columns lined up, and clear of the phone's toolbar.
// Usage: node tests/evidence/calculations/calculations.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/calculations/calculations.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/calculations/seed-calc.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
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
const openCalculate = async () => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Calculate' })); await wait(300) }
const foot = (type, at = 0) => block.locator('tr.database-calc').nth(at).locator(`td.is-${type}`)
const words = async l => (await l.innerText()).replace(/\s+/g, ' ').trim()

await page.goto(`${base}/pages?page=books`); await wait(2500)
check(await block.locator('tr.database-calc').count() === 0, 'nothing at rest')
await openCalculate()
check(await menu.locator('select').count() === 7, 'Name and every shown column', await menu.locator('select').count())
const has = async (name, kind) => (await menu.getByLabel(name, { exact: true }).locator('option').evaluateAll(l => l.map(o => o.value))).includes(kind)
check(await has('Pages', 'sum') && !await has('Kind', 'sum'), 'Sum only for a number')
check(await has('Due', 'dateRange') && await has('Owned', 'percentChecked') && await has('Status', 'percentPerGroup'), 'each type its own')
await shot('panel')
for (const [name, kind] of [['Name', 'countAll'], ['Pages', 'sum'], ['Owned', 'percentChecked'], ['Due', 'earliest'], ['Status', 'countPerGroup'], ['Tags', 'countUnique']]) {
  await menu.getByLabel(name, { exact: true }).selectOption(kind); await wait(600)
}
await closeMenu()
const seen = { name: await words(foot('title')), pages: await words(foot('number')), owned: await words(foot('checkbox')), due: await words(foot('date')), status: await words(foot('status')), tags: await words(foot('multiSelect')) }
check(seen.name === 'Count 34', 'Name counts every row, past the 25 drawn', seen.name)
check(seen.pages === 'Sum 1,012' || seen.pages === 'Sum 1012', 'Pages sums', seen.pages)
check(seen.owned === 'Checked 2.9%', 'Owned percent', seen.owned)
check(seen.due === 'Earliest Oct 25', 'Due earliest', seen.due)
check(seen.status === '○ 2 ◐ 1 ● 31', 'Status per group', seen.status)
check(seen.tags === 'Unique 2', 'Tags unique', seen.tags)
check(store().pages.find(p => p.id === 'list').database.views[0].calculations.number === undefined && store().pages.find(p => p.id === 'list').database.views[0].calculations.pages === 'sum', 'saved on the view')
await shot('foot')

// Lined up with its column; clear of the phone's toolbar.
const columns = await page.evaluate(() => {
  const textLeft = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect() }
  const row = document.querySelector('tr.database-calc'), first = document.querySelector('tr.database-row')
  const name = textLeft(row.querySelector('td.is-title .database-calc-text')), rowName = textLeft(first.querySelector('td.is-title .database-title-cell span'))
  const sum = textLeft(row.querySelector('td.is-number .database-calc-text')), pages = textLeft(first.querySelector('td.is-number .cell-number'))
  return { name: Math.abs(name.left - rowName.left), sum: Math.abs(sum.right - pages.right) }
})
check(columns.name < 1 && columns.sum < 1, 'text on the column: Name from the left, a number from the right', columns)
// Scrolled as far as it goes, the foot and + New are what a tap there hits, not the toolbar.
const toEnd = up => page.evaluate(up => { for (const e of [document.scrollingElement, ...document.querySelectorAll('*')]) if (e && e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY) && !e.closest('.database-scroll')) e.scrollTop = up ? 0 : e.scrollHeight; window.scrollTo(0, up ? 0 : document.documentElement.scrollHeight) }, up)
await toEnd(false); await wait(500)
const end = await page.evaluate(() => {
  const hit = el => { const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hit: at === el || el.contains(at), top: Math.round(r.top), bottom: Math.round(r.bottom), at: String(at?.className).slice(0, 30) } }
  return { foot: hit(document.querySelector('tr.database-calc td.is-title button')), more: hit(document.querySelector('.database-table-wrap > .database-new')) , height: innerHeight, bar: Math.round(document.querySelector('.tab-bar')?.getBoundingClientRect().top || innerHeight) }
})
check(end.foot.hit && end.more.hit && end.more.bottom <= end.bar, 'scrolled to the end, the foot and + New clear the toolbar', end)
await shot('foot-end')
await toEnd(true); await wait(300)

// The filter: past the 25 drawn.
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(300)
await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'Kind' }); await wait(700)
await menu.getByLabel('Essay').last().click({ force: !wide }); await wait(800)
await closeMenu()
check(await words(foot('title')) === 'Count 31' && (await block.locator('tr.database-row').count()) <= 25, 'agrees with the filter, not with what is drawn', [await words(foot('title')), await block.locator('tr.database-row').count()])
check(/Sum 300/.test(await words(foot('number'))), 'and the sum', await words(foot('number')))
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(300)
await tap(menu.getByLabel('Remove filter').first()); await wait(800); await closeMenu()

// Groups: each its own, none when folded.
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300)
await menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select').selectOption({ label: 'Kind' }); await wait(800); await closeMenu()
const groupFoots = await block.locator('tr.database-calc td.is-title').allInnerTexts()
check(groupFoots.map(t => t.replace(/\s+/g, ' ').trim()).join() === 'Count 2,Count 31,Count 1', 'a group has its own', groupFoots)
check(await block.locator('tfoot').count() === 0, 'and there is no second total')
await shot('groups')
await tap(block.locator('.database-group-fold').first()); await wait(400)
check(await block.locator('tr.database-calc').count() === 2, 'a folded group hides its foot')
await tap(block.locator('.database-group-fold').first()); await wait(400)
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300)
await menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select').selectOption(''); await wait(800); await closeMenu()

// A foot cell goes back to the menu; reload; None.
await tap(foot('number').locator('button')); await wait(400)
check(await menu.getByLabel('Pages', { exact: true }).count() === 1, 'a foot cell opens the menu')
await closeMenu()
if (wide) {
  const empty = foot('select').locator('.database-calc-empty')
  const op = () => empty.evaluate(e => getComputedStyle(e).opacity)
  await page.mouse.move(5, 5); await wait(150)
  check(await op() === '0', 'at 1280 another column reads Calculate only on hover')
  await block.locator('tr.database-calc').hover(); await wait(150)
  check(await op() === '1', 'and shows it then')
} else check(await foot('select').locator('button').count() === 0, 'at 390 another column is just blank')
await page.reload(); await wait(2500)
check(await words(foot('number')).then(t => /^Sum 1,?012$/.test(t)), 'it stays after a reload')
await openCalculate()
for (const name of ['Name', 'Pages', 'Owned', 'Due', 'Status', 'Tags']) { await menu.getByLabel(name, { exact: true }).selectOption(''); await wait(500) }
await closeMenu()
check(await block.locator('tr.database-calc').count() === 0 && !('calculations' in store().pages.find(p => p.id === 'list').database.views[0]), 'all None: the foot and the field are gone')

// A board: one calculation per view, in each column's head, the same numbers as a table's foot.
const heads = async () => (await block.locator('.database-column-head').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name: 'Board' })); await wait(700)
if (await menu.getByRole('menuitem', { name: 'Status' }).count()) { await tap(menu.getByRole('menuitem', { name: 'Status' }).first()); await wait(800) }
await closeMenu()
const counted = await heads()
check(counted.some(h => h === 'Finished · 31'), 'a board starts with its count', counted)
await openCalculate()
await menu.getByLabel('Property', { exact: true }).selectOption({ label: 'Pages' }); await wait(800)
check(await menu.getByLabel('Calculate', { exact: true }).inputValue() === 'sum', 'a number starts on Sum')
await shot('board-panel')
await closeMenu()
const summed = await heads()
check(summed.some(h => h === 'Finished · Sum 300') && summed.some(h => h === 'Reading · Sum 412') && summed.some(h => h === 'To read · Sum 300'), 'each column its own sum', summed)
await shot('board')
const onBoard = store().pages.find(p => p.id === 'list').database.views[0]
check(onBoard.boardCalculation?.by === 'pages' && onBoard.boardCalculation?.kind === 'sum', 'saved on the view', onBoard.boardCalculation)
await page.reload(); await wait(2500)
check((await heads()).some(h => h === 'Finished · Sum 300'), 'it stays after a reload')
await openCalculate(); await menu.getByLabel('Calculate', { exact: true }).selectOption('average'); await wait(800); await closeMenu()
check((await heads()).some(h => h === 'Finished · Average 300'), 'another kind', await heads())
await openCalculate(); await menu.getByLabel('Property', { exact: true }).selectOption(''); await wait(800); await closeMenu()
check((await heads()).some(h => h === 'Finished · 31') && !('boardCalculation' in store().pages.find(p => p.id === 'list').database.views[0]), 'Count of rows goes back', await heads())
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name: 'List' })); await wait(800); await closeMenu()
await tap(block.locator('.database-more-button')); await wait(300)
check(await menu.getByRole('menuitem', { name: 'Calculate' }).count() === 0, 'a list has no Calculate')
await closeMenu()

// A linked view keeps its own in its block.
await page.goto(`${base}/pages?page=other`); await wait(2500)
await openCalculate(); await menu.getByLabel('Pages', { exact: true }).selectOption('max'); await wait(900); await closeMenu(); await wait(1800)
check(await words(foot('number')) === 'Max 412', 'a linked view calculates', await words(foot('number')))
const other = JSON.parse(store().pages.find(p => p.id === 'other').document).find(n => n.id === 'linked')
check(JSON.parse(other.props.view).calculations?.pages === 'max' && !('calculations' in store().pages.find(p => p.id === 'list').database.views[0]), 'saved in its block, not on the source', JSON.parse(other.props.view).calculations)

check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
