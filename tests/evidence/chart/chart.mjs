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
  check(d.outside.length === 0, `${what}: everything inside the chart`, d.outside.slice(0, 3)); check(d.overlaps === 0, `${what}: no labels overlap`); check(d.scroll <= 0 && d.wider <= 1, `${what}: no sideways scroll`, [d.scroll, d.wider]); check(d.topped === 0, `${what}: no bar past the plot`)
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
// Line, on the same date axis: a point in each period, the path inside the plot, and a tap opens its rows.
await openLayout(); await menu.getByLabel('By', { exact: true }).selectOption('day'); await wait(800); await menu.getByLabel('Chart').selectOption('line'); await wait(900); await closeMenu()
{ const d = await block.locator('.database-chart').evaluate(c => { const plot = c.querySelector('.database-chart-plot').getBoundingClientRect(), dots = [...c.querySelectorAll('.database-chart-bar u')].map(e => e.getBoundingClientRect()); return { dots: dots.length, outside: dots.filter(b => b.top < plot.top - 5 || b.bottom > plot.bottom + 5 || b.left < plot.left - 5 || b.right > plot.right + 5).length, paths: c.querySelectorAll('.database-chart-line-path path').length } }); check(d.dots > 0 && d.outside === 0 && d.paths >= 1, 'a line: its points are inside the plot, with a path', d) }
// The line itself runs through its points: an SVG can be resized by another rule, which a count of its paths doesn't see.
{ const d = await block.locator('.database-chart').evaluate(c => { const plot = c.querySelector('.database-chart-plot').getBoundingClientRect(), svg = c.querySelector('.database-chart-line-path').getBoundingClientRect(), path = c.querySelector('.database-chart-line-path path').getBoundingClientRect(), dots = [...c.querySelectorAll('.database-chart-bar u')].map(e => e.getBoundingClientRect()); const top = Math.min(...dots.map(b => b.top + b.height / 2)), bottom = Math.max(...dots.map(b => b.top + b.height / 2)); return { svg: [Math.round(svg.width - plot.width), Math.round(svg.height - plot.height)], pathTop: Math.round(path.top - top), pathBottom: Math.round(path.bottom - bottom) } }); check(Math.abs(d.svg[0]) <= 1 && Math.abs(d.svg[1]) <= 1 && Math.abs(d.pathTop) <= 2 && Math.abs(d.pathBottom) <= 2, 'a line: drawn over the plot, through its points', d) }
await drawn('a line'); await shot('line')
await openLayout(); await menu.getByLabel('What to show').selectOption({ label: 'Kind' }); await wait(800); await menu.getByLabel('Chart').selectOption('donut'); await wait(900); await closeMenu()
// A donut: its slices, its legend, its total, and a slice's rows.
{ const d = await block.locator('.database-chart-donut').evaluate(c => ({ slices: c.querySelectorAll('circle').length, legend: [...c.querySelectorAll('.database-chart-legend-item')].map(e => e.innerText.replace(/\s+/g, ' ')), total: c.querySelector('text').textContent, wide: c.getBoundingClientRect().right - c.parentElement.getBoundingClientRect().right })); check(d.slices >= 2 && d.legend.length === d.slices && Number(d.total) === rowsOf().length, 'a donut: slices, a legend, and the total in its centre', d); check(d.wide <= 1, 'a donut stays inside', d.wide) }
{ const d = await block.locator('.database-chart-donut').evaluate(c => { const ring = c.querySelector('svg').getBoundingClientRect(), legend = c.querySelector('.database-chart-legend').getBoundingClientRect(), box = c.getBoundingClientRect(); return { ring: [Math.round(ring.width), Math.round(ring.height)], legendInside: legend.right <= box.right + 1, overlap: !(legend.left >= ring.right - 1 || legend.top >= ring.bottom - 1), legendTop: Math.round(legend.top - box.top) } }); check(d.ring[0] === 180 && d.ring[1] === 180, 'a donut is the size it should be', d.ring); check(d.legendInside && !d.overlap, 'with its legend beside or under it', d) }
await shot('donut'); await tap(block.locator('.database-chart-legend-item').first()); await wait(350); { const t = await block.locator('.database-chart-opened').innerText(); check(t.includes('Novel') && t.includes('Dune'), "a legend's item opens its rows", t.slice(0, 40)) } await tap(block.locator('.database-chart-legend-item').first()); await wait(200)
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
// Jazz's breaks: a very big number, a very long title, long option names, and a long date axis.
{
  const run = (action) => execSync(`node --no-warnings tests/evidence/chart/poke.ts ${storePath} '${JSON.stringify(action).replace(/'/g, "'\\''")}'`, { stdio: 'ignore' })
  const long = 'A very long row title that goes on and on well past the width of any phone at all, without a single break to help'
  run({ type: 'add-row', databaseId: 'list', pageId: 'huge', title: long, values: { kind: 'novel', pages: 1000000000, due: { start: '2024-11-20' } }, at: new Date().toISOString() })
  run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'many', name: 'Many', type: 'select', options: Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, name: `A long option name number ${i}` })) } } })
  for (let i = 0; i < 12; i++) run({ type: 'add-row', databaseId: 'list', pageId: `m${i}`, title: `Many ${i}`, values: { many: `o${i}`, due: { start: `2025-${String((i % 12) + 1).padStart(2, '0')}-10` } }, at: new Date().toISOString() })
  await page.reload(); await wait(2500); await closeMenu()
  await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(250); await tap(menu.getByRole('button', { name: 'Remove filter' }).first()); await wait(900); await closeMenu()
  await openLayout(); await menu.getByLabel('Measure').selectOption({ label: 'Pages' }); await wait(1000); await closeMenu()
  const big = await drawn('a billion'); void big
  const axis = await block.locator('.database-chart-tick span').allInnerTexts(); check(axis.some(t => /[BM]$/.test(t)) && axis.every(t => t.length <= 7), 'the axis reads short', axis)
  { const b = bars().first(), label = await b.getAttribute('aria-label'); check(/1,?000,?000,?\d{3}/.test(label), 'and the exact value is on the bar', label) }
  await tap(bars().first()); await wait(400); await shot('long-title')
  { const o = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, table: (t => t.scrollWidth - t.clientWidth)(document.querySelector('.database-chart-opened .database-chart-table')), value: Math.round(document.querySelector('.database-chart-opened td:last-child').getBoundingClientRect().width) })); check(o.page <= 0 && o.table <= 1 && o.value >= 60, 'a long title in the rows scrolls nothing, and the value keeps its width', o) }
  await tap(bars().first()); await wait(250)
  await openLayout(); await menu.getByLabel('Chart').selectOption('number'); await wait(900); await closeMenu(); await drawn('a huge Number'); check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'a huge Number scrolls nothing'); await shot('huge-number')
  await openLayout(); await menu.getByLabel('Chart').selectOption('bar'); await wait(800); await menu.getByLabel('Measure').selectOption({ label: 'Count' }); await wait(800); await menu.getByLabel('What to show').selectOption({ label: 'Many' }); await wait(900); await closeMenu()
  const named = await block.locator('.database-chart-labels span').count(), across = await block.locator('.database-chart-line').count()
  if (wide) check(across === 13 || named === 13, 'every option is named, one way or the other', [named, across]); else check(across >= 12, 'long options at 390 go across, so each is named', across); await drawn('many long options'); await shot('many-options')
  // Chinese names: every bar is named, by a label in full or by going across, at this width and a tablet's.
  run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'cn', name: '分类', type: 'select', options: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `中文选项${i}号` })) } } })
  for (let i = 0; i < 12; i++) run({ type: 'set-values', pageId: `m${i}`, values: { cn: `c${i}` }, expected: {}, at: new Date().toISOString() })
  await page.reload(); await wait(2500); await openLayout(); await menu.getByLabel('What to show').selectOption({ label: '分类' }); await wait(900); await closeMenu()
  for (const w of wide ? [Number(width), 1000, 768, 600] : [Number(width), 430]) {
    await page.setViewportSize({ width: w, height: wide ? 900 : 844 }); await wait(500)
    const cut = await block.locator('.database-chart-labels span').evaluateAll(x => x.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText)), named = await block.locator('.database-chart-labels span').count(), across = await block.locator('.database-chart-line').count()
    check(cut.length === 0, `Chinese names at ${w}: none cut`, cut.slice(0, 3)); check(named >= 12 || across >= 12, `at ${w}: each is named`, [named, across]); if (w === 768) await shot('chinese-768')
  }
  await page.setViewportSize({ width: Number(width), height: wide ? 900 : 844 }); await wait(400)
  await openLayout(); await menu.getByLabel('What to show').selectOption({ label: 'Due' }); await wait(900); await menu.getByLabel('By', { exact: true }).selectOption('month'); await wait(900); await closeMenu()
  { const l = await block.locator('.database-chart-labels span').allInnerTexts(), cut = await block.locator('.database-chart-labels span').evaluateAll(x => x.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText)); check(cut.length === 0, 'months across years read in full', cut); check(l.filter(t => /\d{4}/.test(t)).length >= 2 && /\d{4}/.test(l[0]), 'with a year on the first and where it changes', l.slice(0, 8)) } await drawn('months'); await shot('months')
  await openLayout(); await menu.getByLabel('By', { exact: true }).selectOption('week'); await wait(900); await closeMenu(); await drawn('weeks across years'); await shot('weeks')
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[chart ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
