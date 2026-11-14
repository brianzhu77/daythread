// R1-18: how long today's page takes to show at 390 with 4× CPU slowdown (Chromium), with a 25-row inline table and
// without one. Median of N loads: navigation start until the page's last line is drawn (and, with the table, its 25th
// row). Usage: node tests/evidence/databases/render-budget.mjs <base-url> <store-path> [runs]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/render-budget.mjs <base-url> <store-path> [runs]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), runs = Number(process.argv[4] ?? 7)
// BUDGET_WIDTH=1280 measures at 1280 with no slowdown, as Map's inline block is only live there; 390 at 4× otherwise.
const wide = process.env.BUDGET_WIDTH === '1280'
// SwiftShader gives headless Chromium the WebGL2 a Map needs; nothing else draws with it.
const browser = await pw.chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const measure = async (variant) => {
  execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-day-table.ts ${storePath} ${variant}`, { stdio: 'ignore' })
  const times = []
  for (let i = 0; i < runs + 1; i++) {
    const page = await browser.newPage(wide ? { viewport: { width: 1280, height: 900 } } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: wide ? 1 : 4 })
    const start = Date.now()
    await page.goto(`${base}/`)
    await page.getByText('Line 39 of the day').waitFor({ timeout: 60000 })
    // A chart is drawn when its second bar is, after its code has loaded; a table when its 25th row is.
    // A Map block counts as drawn when its frame is (1280), or at 390 its line to the full page. Its map loads later,
    // only once the block nears the screen, so the day pays for the frame and nothing more.
    if (variant === 'map') await (wide ? page.locator('.map-frame') : page.getByRole('button', { name: 'Open the map ›' })).first().waitFor({ state: 'attached', timeout: 60000 })
    // In view on open (`map-top`, 1280): until the map is drawn with its pins, its chunk, style and tiles included. Stated, not gated.
    else if (variant === 'map-top') await (wide ? page.locator('.map-frame.is-ready') : page.getByRole('button', { name: 'Open the map ›' })).first().waitFor({ timeout: 60000 })
    else if (variant === 'chart') await page.locator('.database-chart-bar').nth(1).waitFor({ timeout: 60000 })
    else if (variant === 'feed') await page.locator('.feed-card').nth(24).waitFor({ timeout: 60000 })
    else if (variant !== 'plain') await page.locator('.database-row').nth(24).waitFor({ timeout: 60000 })
    const ms = Date.now() - start
    if (i > 0) times.push(ms) // the first load warms the dev server's module cache
    await page.close()
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1) }
}
// BUDGET_VARIANTS=relation,todos measures only those, against plain; BUDGET_WIDTH=1280 BUDGET_VARIANTS=linked,map compares a Map block with a table one at 1280. `cover` isn't in the default set: BUDGET_VARIANTS=table,cover compares a day with a cover to one without.
const variants = (process.env.BUDGET_VARIANTS ?? 'table,linked,chart,todos,relation,formula,sub-items').split(',')
const plain = await measure('plain'), out = { runs, plain }
for (const v of variants) { out[v] = await measure(v); out[`extra_${v}`] = out[v].median - plain.median }
console.log(JSON.stringify(out))
await browser.close()
