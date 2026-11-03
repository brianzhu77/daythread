// R3-4 Any rule matches in the built app, on a fresh store from board/seed-board.ts: the switch at two rules, the rows, "or" on the line of
// rules, a reload, + New taking one value or saying it's hidden, and back to all.
// Usage: node tests/evidence/filter-any/filter-any.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/filter-any/filter-any.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
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
const view = () => store().pages.find(p => p.id === 'list').database.views[0]
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const count = async () => { const seen = new Set(await block.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row))); return seen }
const openFilter = async () => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(200) }

await page.goto(`${base}/pages?page=books`); await wait(2500)
await openFilter()
check(await menu.getByLabel('Show rows where').count() === 0, 'no switch with no rules')
await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'Kind' }); await wait(700)
await menu.getByLabel('Essay').last().click({ force: !wide }); await wait(800)
check(await menu.getByLabel('Show rows where').count() === 0, 'none with one rule')
await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'Pages' }); await wait(700)
await menu.getByLabel('Condition').last().selectOption('gt'); await wait(500)
await menu.getByLabel('Value').last().fill('350'); await page.keyboard.press('Enter'); await wait(900)
check(await menu.getByLabel('Show rows where').count() === 1, 'the switch at two rules')
await shot('sheet')
check((await count()).size === 0, 'all rules: no row is both', [...await count()])
await menu.getByLabel('Show rows where').selectOption('any'); await wait(900)
check(view().filterAny === true, 'saved on the view', view().filterAny)
await closeMenu()
const any = await count()
check(any.has('dune') && any.has('ubik') && !any.has('emma') && !any.has('blank'), 'any: rows matching either', [...any].slice(0, 5))
check((await block.locator('.database-filter-or').allInnerTexts()).join() === 'or', 'the line of rules reads or')
await shot('any')
await page.reload(); await wait(2500)
const again = await count()
check(again.has('dune') && again.has('ubik'), 'it stays after a reload')
// + New: the first rule's single value shows it.
await page.locator('.database-new').last().scrollIntoViewIfNeeded()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
const made = store().pages.filter(p => p.parentId === 'list').at(-1)
check(made.values?.kind === 'essay' && made.values?.pages === undefined, '+ New takes one value', made.values)
if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) }
check(await page.getByText("hidden by this view's filter").count() === 0, 'and says nothing, since it shows')
// Back to all.
await openFilter(); await menu.getByLabel('Show rows where').selectOption('all'); await wait(900); await closeMenu()
check(view().filterAny === undefined && (await count()).size === 0 && await block.locator('.database-filter-or').count() === 0, 'back to all')
// A rule on a deleted property doesn't count.
await openFilter(); await menu.getByLabel('Show rows where').selectOption('any'); await wait(800); await closeMenu()
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: /Properties/ })); await wait(200); await tap(menu.getByRole('button', { name: /^Pages/ })); await wait(200); await tap(menu.getByRole('menuitem', { name: 'Delete property' })); await wait(1000); await closeMenu()
const left = await count()
check(left.has('ubik') && !left.has('dune'), 'a deleted property\'s rule neither lets all in nor hides all', [...left].slice(0, 4))
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
