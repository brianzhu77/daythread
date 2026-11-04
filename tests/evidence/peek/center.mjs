// R4-11 center peek in the built app, on a fresh store from board/seed-board.ts: the setting, opening over the view, the same page's save and Undo in it, Esc's order, Back, a reload,
// ↑ ↓, ↗, a tap outside, and a window below the floor. Usage: node tests/evidence/peek/center.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/center.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${name}.png` }) }
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu'), peek = page.locator('.peek')
const titleCell = id => block.locator(`tr[data-row="${id}"] .database-title-cell`)
const openRowFromTable = async id => { await titleCell(id).hover(); await block.locator(`tr[data-row="${id}"] .database-open`).click(); await wait(1500) }

await page.goto(`${base}/pages?page=books`); await wait(2500)
await openRowFromTable('dune')
check(page.url().includes('page=dune') && !page.url().includes('peek='), 'by default a row still opens as a full page')
await page.goBack(); await wait(1800)

await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
await menu.getByLabel('Open pages in').selectOption('center'); await wait(700)
await page.keyboard.press('Escape'); await wait(300); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }); await wait(300) }
check(pageOf('list').database.views[0].openIn === 'center', 'the setting is saved on the view', pageOf('list').database.views[0].openIn)

const urlBefore = page.url()
await openRowFromTable('dune')
check(await peek.count() === 1 && page.url().includes('peek=dune') && page.url().includes('page=books'), 'it opens over the view, in the URL', page.url())
check(await block.count() === 1, 'and the view is still behind it')
check(await peek.locator('.page-title-field').innerText() === 'Dune' && await peek.locator('.row-property-name').count() > 0, 'with the row’s title and properties')
await shot('center')

// Typing, then Esc: closes, and what he typed is saved. One Esc per layer.
await peek.locator('.bn-inline-content').first().click(); await page.keyboard.type('Peek words'); await wait(150)
await page.keyboard.type(' /'); await wait(400)
check(await page.locator('#bn-suggestion-menu').count() === 1, 'the / list opens inside it')
await shot('center-menu')
await page.keyboard.press('Escape'); await wait(300)
check(await peek.count() === 1 && await page.locator('#bn-suggestion-menu').count() === 0, 'Esc closes the list first, not the peek')
await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await wait(100)
// A composition is the innermost layer of all.
await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))); await wait(200)
check(await peek.count() === 1, 'Esc during a composition leaves the peek open')
const y = await peek.evaluate(el => el.scrollTop), pageY = await page.evaluate(() => scrollY)
await page.keyboard.press('Escape'); await wait(1200)
check(await peek.count() === 0 && page.url() === urlBefore, 'then Esc closes it and the URL goes back', page.url())
check(pageOf('dune').document.includes('Peek words'), 'what he typed is saved')
check(await page.evaluate(() => scrollY) === pageY, 'the view is where it was', [y, pageY])

// Undo in it acts on its own editor.
await openRowFromTable('dune')
await peek.locator('.bn-inline-content').first().click(); await page.keyboard.press('End').catch(() => {}); await page.keyboard.type('X'); await wait(900)
await page.keyboard.press('Meta+z'); await wait(900)
const behind = pageOf('books').document
check(!(await peek.locator('.bn-inline-content').first().innerText()).includes('X') && pageOf('books').document === behind, 'Undo acts on the row, not the page behind')
// Undo can leave words selected: that's a layer of its own.
await page.keyboard.press('Escape'); await wait(300)
if (await peek.count()) { await page.keyboard.press('Escape'); await wait(1000) }
check(await peek.count() === 0, 'Esc closes it after any selection')

// Back closes it; Forward and a reload open it.
await openRowFromTable('emma')
await page.goBack(); await wait(1000)
check(await peek.count() === 0 && page.url() === urlBefore, 'Back closes it')
await page.goForward(); await wait(1500)
check(await peek.count() === 1, 'Forward opens it again')
await page.reload(); await wait(2500)
check(await peek.count() === 1 && page.url().includes('peek=emma'), 'a reload reopens it')
await page.mouse.click(10, 450); await wait(1000)
check(await peek.count() === 0, 'a tap outside closes it')

// ↑ ↓ walk the view's order, without adding to Back; ↗ opens the full page.
await openRowFromTable('dune')
const atStart = page.url()
await peek.getByRole('button', { name: 'Next row' }).click(); await wait(1200)
const moved = new URL(page.url()).searchParams.get('peek')
check(moved && moved !== 'dune' && await peek.locator('.page-title-field').innerText() === pageOf(moved).title, 'the next row replaces it', moved)
await peek.getByRole('button', { name: 'Previous row' }).click(); await wait(1200)
check(page.url() === atStart, 'and back')
await peek.getByRole('button', { name: 'Next row' }).click(); await wait(1200)
await page.goBack(); await wait(1000)
check(await peek.count() === 0 && page.url() === urlBefore, 'Back still closes it, in one step', page.url())
await openRowFromTable('dune')
await peek.getByRole('button', { name: 'Open as a full page' }).click(); await wait(1500)
check(await peek.count() === 0 && page.url().includes('page=dune') && !page.url().includes('peek'), '↗ opens the full page', page.url())

// Timeline keeps the setting too: its rows go through the same open. Back to Table afterwards, for the checks below.
await page.goto(`${base}/pages?page=books`); await wait(2300)
const chooseLayout = async name => { await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300); await menu.getByRole('menuitemradio', { name, exact: true }).click(); await wait(700); await page.keyboard.press('Escape'); await wait(300); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }); await wait(300) } }
await chooseLayout('Timeline')
if (await block.locator('.database-undated-head').count()) { await block.locator('.database-undated-head').click(); await wait(300) }
await block.locator('.database-bar-off.is-name, .database-pane-name').first().click(); await wait(1500)
check(await peek.count() === 1 && page.url().includes('peek='), 'a row on a Timeline opens in the peek', page.url())
check((await page.evaluate(() => document.activeElement?.closest('.ProseMirror') != null)), 'it opens with the caret in its editor')
await page.keyboard.press('Escape'); await wait(1000)
check(await peek.count() === 0, 'and one Esc closes it')
await chooseLayout('Table')

// The row's own page behind: nothing opens. Below the floor: a full page. Resized past the floor, nothing's lost.
await page.goto(`${base}/pages?page=dune&peek=dune`); await wait(2500)
check(await peek.count() === 0 && !page.url().includes('peek='), 'a peek of the page behind closes itself', page.url())
await page.goto(`${base}/pages?page=books`); await wait(2300)
await openRowFromTable('emma')
await peek.locator('.bn-inline-content').first().click(); await page.keyboard.type('Before resize'); await wait(100)
await page.setViewportSize({ width: 800, height: 900 }); await wait(2000)
check(await peek.count() === 0 && page.url().includes('page=emma'), 'below the floor it opens as a full page', page.url())
check(pageOf('emma').document.includes('Before resize'), 'and what he typed is saved')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
