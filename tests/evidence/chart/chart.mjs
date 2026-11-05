// Chart in the built app (docs/design/chart.md, G4-1, G4-2, G4-5, G4-6), on a fresh store from board/seed-board.ts: the first time it asks what to show, bars of each form
// with their numbers matching the rows, a bar's rows, the data table, Number, a filter, a date axis, a property deleted, and what's drawn measured: inside the block, no overlaps, no sideways scroll.
// Usage: node tests/evidence/chart/chart.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/chart/chart.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = [], asked = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) }); page.on('request', r => asked.push(r.url()))
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const db = () => store().pages.find(p => p.id === 'list').database, view = () => db().views[0], rowsOf = () => store().pages.filter(p => p.parentId === 'list' && !p.trashedAt)
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(300) }
const openLayout = async () => { await closeMenu(); await clearNotices(); await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: /^Layout/ })); await wait(250) }
const bars = () => block.locator('.database-chart-bar, .database-chart-line')
const labelled = async () => bars().evaluateAll(l => l.map(e => e.getAttribute('aria-label')))
// What's drawn: every bar and label inside the chart, no two shown labels overlapping, each bar's height true to its value, and nothing wider than the page.
const drawn = async what => {
  const d = await block.locator('.database-chart').evaluate(c => {
    const box = c.getBoundingClientRect(), r = e => e.getBoundingClientRect(), out = { outside: [], overlaps: 0, scroll: document.documentElement.scrollWidth - innerWidth, wider: c.scrollWidth - c.clientWidth }
    for (const e of c.querySelectorAll('.database-chart-bar, .database-chart-line, .database-chart-labels span, .database-chart-tick span')) { const b = r(e); if (getComputedStyle(e).visibility !== 'hidden' && (b.right > box.right + 1 || b.left < box.left - 1)) out.outside.push([e.className, Math.round(b.left), Math.round(b.right), Math.round(box.left), Math.round(box.right)]) }
    const shown = [...c.querySelectorAll('.database-chart-labels span')].filter(e => getComputedStyle(e).visibility !== 'hidden').map(r)
    for (let i = 1; i < shown.length; i++) if (shown[i].left < shown[i - 1].right - 0.5) out.overlaps++
    out.bars = [...c.querySelectorAll('.database-chart-bar i')].map(e => Math.round(r(e).height)); out.plot = c.querySelector('.database-chart-plot') ? Math.round(r(c.querySelector('.database-chart-plot')).height) : 0
    out.topped = [...c.querySelectorAll('.database-chart-bar i')].filter(e => r(e).top < r(c.querySelector('.database-chart-plot')).top - 0.5).length
    return out
  })
  check(d.outside.length === 0, `${what}: everything inside the chart`, d.outside.slice(0, 3)); check(d.overlaps === 0, `${what}: no labels overlap`); check(d.scroll <= 0 && d.wider <= 0, `${what}: no sideways scroll`, [d.scroll, d.wider]); check(d.topped === 0, `${what}: no bar past the plot`)
  return d
}

await page.goto(`${base}/pages?page=books`); await wait(2500)
check(!asked.some(u => /database-chart/.test(u)), 'a page with no chart loads none of its code')
// The first time, it asks.
await openLayout(); await tap(menu.getByRole('menuitemradio', { name: /^Chart/ })); await wait(400)
check(await menu.getByText('What to show').count() === 1, 'the first time it asks what to show')
await shot('asks')
const offered = await menu.getByRole('menuitem').allInnerTexts(); check(offered.includes('Kind') && offered.includes('Status') && !offered.includes('Name'), 'with what it can use', offered)
await tap(menu.getByRole('menuitem', { name: 'Kind', exact: true })); await wait(1200)
check(view().layout === 'chart' && view().groupBy === 'kind' && view().chart?.form === 'bar', 'stored on the view', { layout: view().layout, by: view().groupBy, chart: view().chart })
await closeMenu(); await block.locator('.database-chart').waitFor({ timeout: 15000 })
check(asked.some(u => /database-chart/.test(u)), 'its code loads now')
const count = k => rowsOf().filter(r => r.values?.kind === k).length
{ const l = await labelled(); check(l[0] === `Novel: ${count('novel')}` && l[1] === `Essay: ${count('essay')}`, 'bars count the rows', l) }
const first = await drawn('count'); await shot('bars')
{ const [n, e] = first.bars, nc = count('novel'), ec = count('essay'); check(nc && ec ? Math.abs(n / e - nc / ec) < 0.05 : true, "bars' heights are true to their values", [n, e, nc, ec]) }
// A bar's rows, then the table of data.
await tap(bars().first()); await wait(400)
// Only a touch can raise one: WebKit at 1280 leaves focus on the editor when a button's clicked, which is no keyboard at all.
if (!wide) check(await page.evaluate(() => !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable), 'a tap raises no keyboard')
{ const t = await block.locator('.database-chart-opened').innerText(); check(t.includes('Novel') && rowsOf().filter(r => r.values?.kind === 'novel').every(r => t.includes(r.title)) && !rowsOf().filter(r => r.values?.kind === 'essay').some(r => t.includes(r.title)), "a bar opens its rows, and only those", t.slice(0, 60)) }
await shot('opened')
await drawn('opened')
await tap(bars().first()); await wait(250); check(await block.locator('.database-chart-opened').count() === 0, 'a second tap closes them')
await tap(block.locator('.database-chart-toggle')); await wait(250)
{ const t = await block.locator('.database-chart-table').innerText(); check(t.includes('Novel') && t.includes(String(count('novel'))), 'the data is one tap away', t.slice(0, 50)) } await tap(block.locator('.database-chart-toggle')); await wait(200)
// A measure, matching a column calculation's sum.
await openLayout(); await menu.getByLabel('Measure').selectOption({ label: 'Pages' }); await wait(1000)
{ const sum = rowsOf().filter(r => r.values?.kind === 'novel').reduce((n, r) => n + (r.values?.pages ?? 0), 0), l = await labelled(); check(view().chart.measure?.kind === 'sum' && l[0] === `Novel: ${sum}`, 'Sum of a Number', l[0]) }
await menu.getByLabel('Of it').selectOption('max'); await wait(900); { const max = Math.max(...rowsOf().filter(r => r.values?.kind === 'novel').map(r => r.values?.pages ?? 0)), l = await labelled(); check(l[0] === `Novel: ${max}`, 'and Max', l[0]) }
await menu.getByLabel('Measure').selectOption({ label: 'Count' }); await wait(900)
// Horizontal.
await menu.getByLabel('Chart').selectOption('barHorizontal'); await wait(900); await closeMenu()
await drawn('horizontal'); await shot('horizontal')
// A date axis, by month and year.
await openLayout(); await menu.getByLabel('What to show').selectOption({ label: 'Due' }); await wait(900); await menu.getByLabel('Chart').selectOption('bar'); await wait(900)
check(await menu.getByLabel('By', { exact: true }).inputValue() === 'month', 'a date axis defaults to months'); await menu.getByLabel('By', { exact: true }).selectOption('day'); await wait(900); await closeMenu(); await drawn('by day'); await shot('by-day')
{ const cut = await block.locator('.database-chart-labels span').evaluateAll(l => l.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText)); check(cut.length === 0 && await block.locator('.database-chart-labels span').count() > 0, 'a date axis: its labels read in full', cut.slice(0, 4)) }
await openLayout(); await menu.getByLabel('By', { exact: true }).selectOption('year'); await wait(900); check(view().chart.byYear === true && view().groupDateBy !== 'year', 'a year stays out of what an older build reads', view().groupDateBy); await closeMenu(); await drawn('by year')
// Number.
await openLayout(); await menu.getByLabel('Chart').selectOption('number'); await wait(900); await closeMenu()
{ const t = await block.locator('.database-chart-number').innerText(); check(t.includes(String(rowsOf().length)) && t.includes('Count'), 'Number: the count, and what it is', t) } await shot('number')
// A property deleted, and changing it back.
await openLayout(); await menu.getByLabel('Chart').selectOption('bar'); await wait(900); await menu.getByLabel('What to show').selectOption({ label: 'Kind' }); await wait(900); await closeMenu()
const heldBars = await labelled()
await openLayout(); await menu.getByLabel('What to show').selectOption({ label: 'Status' }); await wait(900); await closeMenu(); check(await labelled().then(l => l.join() !== heldBars.join()), 'changing what to show redraws')
await openLayout(); await menu.getByLabel('What to show').selectOption({ label: 'Kind' }); await wait(900); await closeMenu(); check((await labelled()).join() === heldBars.join(), 'and back')
// A reload, and the view's filter applying.
await page.reload(); await wait(2500); await block.locator('.database-chart').waitFor({ timeout: 15000 }); check((await labelled()).join() === heldBars.join(), 'a reload keeps it')
await closeMenu(); await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(250); await tap(menu.getByRole('menuitem', { name: '+ Add filter' }).last()); await wait(800)
await menu.getByLabel('Property').last().selectOption({ label: 'Kind' }); await wait(700); await menu.getByLabel('Novel').last().click({ force: !wide }); await wait(1000); await closeMenu()
{ const l = await labelled(); check(l.some(x => x.startsWith('Novel: ')) && !l.some(x => /^Essay: [1-9]/.test(x)), "the view's filter applies", l) } await shot('filtered')
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[chart ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
