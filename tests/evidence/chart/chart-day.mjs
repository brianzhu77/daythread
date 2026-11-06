// G4-7 on a copy of his data: charts in his Day template. Each new day gets its own, showing that day's rows; making a day stays one
// operation; the chart's code is fetched only by a day with a chart; a chart that can't load leaves the day working; and how far the
// lines below move when a chart arrives. Adds the charts to the copy it's given, so give it a throwaway copy.
// Usage: node tests/evidence/chart/chart-day.mjs <base-url> <copy-store-path> <1280|390> [chromium|webkit] [shots-dir]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/chart/chart-day.mjs <base-url> <copy-store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
const ws = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
execSync(`node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const seeded = execSync(`node tests/evidence/databases/template-view-seed.ts ${storePath} chart`).toString()
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const chunk = /\/assets\/database-chart-[\w-]+\.js$/
// Each look is a fresh tab with nothing cached, so what it fetches is what that day needs.
const look = async (path, route) => {
  const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
  if (route) await context.route(chunk, route)
  const page = await context.newPage(), errors = [], asked = []
  page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) }); page.on('request', r => asked.push(r.url()))
  await page.goto(`${base}${path}`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 })
  return { context, page, errors, asked, fetched: () => asked.filter(u => chunk.test(new URL(u).pathname)).length }
}
const tap = (page, l) => (wide ? l.click() : l.tap())

// Making each day was one operation and made nothing else, as without a chart.
for (const date of ['2026-12-20', '2026-12-21']) { const m = seeded.match(new RegExp(`${date} operations (\\d+) databases made (\\d+) tasks made (\\d+)`)); check(m && m[1] === '1' && m[2] === '0', `making ${date} is one operation and makes no database`, m?.slice(1)) }

// A day from before the charts: none drawn, and the chart's code not fetched.
{ const v = await look('/day/2026-12-19'); await v.page.waitForTimeout(2500); check((await v.page.locator('.database-block').count()) === 0 && v.fetched() === 0, 'a day with no chart fetches no chart code', { blocks: await v.page.locator('.database-block').count(), fetched: v.fetched() }); check(v.errors.length === 0, 'no page errors there', v.errors.slice(0, 2)); await v.context.close() }

// Each new day: its own two charts, with that day's rows and not the other's.
for (const [date, mine, other] of [['2026-12-20', 'Due the 20th', 'Due the 21st'], ['2026-12-21', 'Due the 21st', 'Due the 20th']]) {
  const v = await look(`/day/${date}`); const { page } = v
  await page.locator('.database-chart-bar').first().waitFor({ timeout: 20000 }); await page.locator('.database-chart-number').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800)
  const day = ws().pages.find(p => p.date === date), blocks = JSON.parse(day.document).filter(n => n.type === 'database')
  check(blocks.length === 2 && !blocks.some(b => b.id === 'tv1' || b.id === 'tv2') && (await page.locator('.database-chart').count()) === 2, `${date}: two charts of its own`, { blocks: blocks.map(b => b.id.slice(0, 8)), drawn: await page.locator('.database-chart').count() })
  check(v.fetched() === 1, `${date}: the chart's code fetched once for both`, v.fetched())
  const number = (await page.locator('.database-chart-number strong').first().innerText()).trim()
  check(number === '1', `${date}: Number counts that day's one row`, number)
  const bar = page.locator('.database-chart-bar').first(); await bar.scrollIntoViewIfNeeded(); await tap(page, bar); await page.waitForTimeout(400)
  const opened = await page.locator('.database-chart-opened').first().innerText().catch(() => '')
  check(opened.includes(mine) && !opened.includes(other), `${date}: its bar opens that day's row only`, opened.replace(/\s+/g, ' ').slice(0, 80))
  if (shots) { await page.locator('.database-chart').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/${engine}-${width}-${date}.png` }) }
  check(v.errors.length === 0, `${date}: no page errors`, v.errors.slice(0, 2))
  await v.context.close()
}

// The chart's code held back 1.5 s: what's below each chart moves by the difference between its placeholder and what's drawn.
{
  const v = await look('/day/2026-12-21', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue() }); const { page } = v
  await page.locator('.database-chart-loading').first().waitFor({ timeout: 20000 })
  // Each chart block's own height: the placeholder's, then what's drawn. What's below moves by the difference.
  const below = () => page.locator('.database-block').evaluateAll(l => l.map(b => Math.round(b.getBoundingClientRect().height)))
  const before = await below()
  await page.locator('.database-chart-number').first().waitFor({ timeout: 20000 }); await page.locator('.database-chart-bar').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(500)
  const after = await below(), heights = await page.locator('.database-chart').evaluateAll(l => l.map(e => Math.round(e.getBoundingClientRect().height)))
  console.log('INFO each chart block, placeholder then drawn (px), bar then Number:', JSON.stringify({ before, after, moved: after.map((a, i) => a - before[i]), charts: heights }))
  await v.context.close()
}

// The chart's code can't be fetched (offline, or a new build's file not kept yet): the day still opens and takes typing.
{
  const v = await look('/day/2026-12-21', route => route.abort()); const { page } = v
  await page.waitForTimeout(3000)
  const broken = /Something went wrong/i.test(await page.locator('body').innerText())
  const line = page.locator('.bn-block-content[data-content-type="paragraph"] .bn-inline-content').first()
  let typed = false
  if (!broken && await line.count()) { await tap(page, line); await page.keyboard.type('still here'); await page.waitForTimeout(400); typed = (await page.locator('.bn-editor').first().innerText()).includes('still here') }
  // And it saves, as on any day.
  let saved = false
  for (let i = 0; i < 30 && typed && !saved; i++) { await page.waitForTimeout(300); saved = ws().pages.find(p => p.date === '2026-12-21').document.includes('still here') }
  const shown = await page.locator('.database-block').evaluateAll(l => l.map(e => e.innerText.replace(/\s+/g, ' ').slice(-30)))
  // Failed, each keeps the height it holds while loading, so nothing below moves (Jazz).
  const failedHeights = await page.locator('.database-chart-loading.is-unavailable').evaluateAll(l => l.map(e => Math.round(e.getBoundingClientRect().height)))
  check(failedHeights.join() === (wide ? '304,106' : '272,106'), 'failed, each keeps the height it held', failedHeights)
  check(!broken && typed && saved && shown.every(t => t.includes('Chart unavailable')), "a chart whose code can't load says so in its place, and the day still takes typing and saves", { broken, typed, saved, shown })
  if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-no-chart-code.png` })
  // Back online: Reload saves and reloads (a browser won't fetch a failed module twice), the charts draw, and the words are kept.
  await v.context.unroute(chunk)
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }).catch(() => null), tap(page, page.locator('.database-chart-loading.is-unavailable button').first())])
  await page.locator('.database-chart').nth(1).waitFor({ timeout: 20000 }).catch(() => {})
  const kept = (await page.locator('.bn-editor').first().innerText()).includes('still here')
  check((await page.locator('.database-chart').count()) === 2 && kept, 'and Reload, once the code can be fetched, draws them with the words kept', { charts: await page.locator('.database-chart').count(), kept, fetched: v.fetched() })
  await v.context.close()
}
console.log(`[chart-day ${engine} ${width}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
