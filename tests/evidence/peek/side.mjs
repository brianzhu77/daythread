// Side peek (R4-11, peek.md §3, §4) in the built app, on a fresh store from board/seed-board.ts: the view stays usable beside it, another row replaces it after saving,
// a cell edited on the open row loses nothing, ↑ ↓ follow the drawn order across groups, only ×, Esc and Back close it, and the floors hold what's typed.
// Usage: node tests/evidence/peek/side.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/side.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
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
const block = page.locator('.app-main .database-block').first(), menu = page.locator('.database-menu'), peek = page.locator('.peek')
const scrollEl = page.locator('.app-main .database-scroll').first()
const openRow = async id => { const row = block.locator(`tr[data-row="${id}"]`); await row.locator('.database-title-cell').hover(); await row.locator('.database-open').click(); await wait(1400) }
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(300) }
const typeInPeek = async words => { await peek.locator('.bn-inline-content').first().click(); await page.keyboard.press('End'); await page.keyboard.type(words); await wait(60) }

await page.goto(`${base}/pages?page=books`); await wait(2500)
await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
await menu.getByLabel('Open pages in').selectOption('side'); await wait(700); await closeMenu()
check(pageOf('list').database.views[0].openIn === 'side', 'the setting is saved on the view', pageOf('list').database.views[0].openIn)

// Opening: beside the view, at about half the window, and the view has what's left.
await page.evaluate(() => window.scrollTo(0, 60)); await wait(150)
const scrollBefore = await page.evaluate(() => scrollY)
await openRow('dune')
const p = await peek.boundingBox(), main = await page.locator('.app-content').boundingBox()
check(await peek.count() === 1 && page.url().includes('peek=dune') && page.url().includes('side=1'), 'a row opens in a side peek', page.url())
check(Math.round(p.x + p.width) === 1280 && p.height === 900 && p.width >= 420, 'it runs down the right of the window', p)
check(main.width >= 420 && Math.round(main.x + main.width) <= Math.round(p.x), 'the view has what\'s left, none of it under the peek', main)
check(await page.locator('.peek-scrim.is-side').evaluate(e => getComputedStyle(e).display) === 'contents', 'with no scrim')
check(await page.evaluate(() => scrollY) === scrollBefore, 'and the view hasn\'t moved', [scrollBefore, await page.evaluate(() => scrollY)])
check(await block.locator('tr[data-row="dune"] > td').first().evaluate(e => getComputedStyle(e).backgroundColor) !== await block.locator('tr[data-row="emma"] > td').first().evaluate(e => getComputedStyle(e).backgroundColor), 'the open row is marked in the view')
await shot('side')

// The view works beside it: a page's scroll, a cell, empty space.
check(await page.evaluate(() => { const before = scrollY; window.scrollBy(0, 40); const moved = scrollY !== before; window.scrollTo(0, before); return moved }), 'the page beside it still scrolls')
await block.locator('tr[data-row="emma"] td.is-number').first().click(); await wait(400)
await page.keyboard.press('Meta+a'); await page.keyboard.type('77'); await page.keyboard.press('Enter'); await wait(900)
const pagesValue = () => pageOf('emma').values?.pages
check(pagesValue() === 77 && await peek.count() === 1, 'a cell in the view edits with the peek open', pagesValue())
await page.mouse.click(main.x + 8, 12); await wait(300)
check(await peek.count() === 1 && page.url().includes('peek=dune'), 'a tap on empty space leaves it open', page.url())

// Another row replaces it, after saving: what was typed is there, in one history entry.
await typeInPeek(' side words')
const historyBefore = await page.evaluate(() => history.length)
await openRow('emma')
check(page.url().includes('peek=emma') && await peek.count() === 1, 'another row replaces it')
for (let i = 0; i < 12 && !pageOf('dune').document.includes('side words'); i++) await wait(500)
check(pageOf('dune').document.includes('side words'), 'what was typed in the last one is saved', pageOf('dune').document.slice(0, 200))
check(await page.evaluate(() => history.length) === historyBefore, 'moving to it adds no history entry', [historyBefore, await page.evaluate(() => history.length)])

// §4: a cell edited on the open row, with typing still on its way.
await typeInPeek(' typed then')
await block.locator('tr[data-row="emma"] td.is-number').first().click(); await wait(150)
await page.keyboard.press('Meta+a'); await page.keyboard.type('88'); await page.keyboard.press('Enter'); await wait(1600)
const emma = pageOf('emma')
const notice = await page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | '))
check(emma.values?.pages === 88 && emma.document.includes('typed then'), 'a cell edited on the open row keeps the cell and the typing', [emma.values?.pages])
check(!/changed elsewhere/i.test(notice), 'and says nothing about a change elsewhere', notice)

// Closing: ×, Esc, Back, and the row isn't flashed.
await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(800)
check(await peek.count() === 0 && !page.url().includes('peek=') && !page.url().includes('side=') && await page.evaluate(() => document.documentElement.classList.contains('has-side-peek')) === false, '× closes it and gives the view its width back')
await openRow('dune')
await peek.locator('.bn-inline-content').first().click(); await page.keyboard.press('Escape'); await wait(800)
check(await peek.count() === 0, 'Esc with the caret in it closes it')
await openRow('dune')
await page.goBack(); await wait(1000)
check(await peek.count() === 0 && page.url().includes('page=books'), 'Back closes it')

// Esc in the view's own field: the field first.
await openRow('dune')
await block.locator('tr[data-row="emma"] td.is-number').first().click(); await wait(300)
await page.keyboard.press('Escape'); await wait(400)
check(await peek.count() === 1, 'Esc in a cell behind it leaves the cell, not the peek')
await page.evaluate(() => { document.activeElement?.blur?.() }); await page.keyboard.press('Escape'); await wait(800)

// A reload reopens it as a side peek. There's no row list then.
await openRow('dune')
await page.reload(); await wait(2500)
check(await peek.evaluate(e => e.classList.contains('is-side')) && await peek.getByRole('button', { name: 'Next row' }).count() === 0, 'a reload reopens it at the side, with no ↑ ↓')
await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(800)

// ↑ ↓: the drawn order, across groups.
await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('button', { name: 'Group', exact: true }).click(); await wait(300)
await menu.getByLabel('Group by').selectOption({ label: 'Kind' }); await wait(800); await closeMenu()
const drawn = await block.locator('tr[data-row]').evaluateAll(all => [...new Set(all.map(r => r.dataset.row))])
const inOrder = (await store().pages.filter(x => x.parentId === 'list').map(x => x.id))
await openRow(drawn[0])
const walked = [drawn[0]]
const next = peek.getByRole('button', { name: 'Next row' })
for (let i = 0; i < 4; i++) { await next.click(); await wait(700); walked.push(new URL(page.url()).searchParams.get('peek')) }
check(walked.join() === drawn.slice(0, 5).join(), '↓ walks the rows as they\'re drawn, across groups', { walked, drawn: drawn.slice(0, 5), stored: inOrder.slice(0, 5) })
await peek.getByRole('button', { name: 'Previous row' }).click(); await wait(700)
check(new URL(page.url()).searchParams.get('peek') === drawn[3], '↑ goes back')
await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(800)
await page.goto(`${base}/pages?page=books`); await wait(2300)

// The floors, with a window resized and what's typed kept.
await openRow(drawn[0])
await typeInPeek(' across floors')
await page.setViewportSize({ width: 1000, height: 900 }); await wait(800)
check(await peek.count() === 1 && !(await peek.evaluate(e => e.classList.contains('is-side'))) && (await peek.locator('.bn-inline-content').first().innerText()).includes('across floors'), 'under 1100 it becomes a center peek, with the words still there')
await shot('center-from-side')
await page.setViewportSize({ width: 1280, height: 900 }); await wait(800)
check(await peek.evaluate(e => e.classList.contains('is-side')) && (await peek.locator('.bn-inline-content').first().innerText()).includes('across floors'), 'back over 1100 it\'s at the side again, the words still there')
await page.setViewportSize({ width: 800, height: 900 }); await wait(2000)
check(await peek.count() === 0 && page.url().includes(`page=${drawn[0]}`), 'under 900 it opens as a full page', page.url())
check(pageOf(drawn[0]).document.includes('across floors'), 'and what was typed is saved')
await page.setViewportSize({ width: 1280, height: 900 }); await wait(500)
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
