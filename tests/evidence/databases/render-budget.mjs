// R1-18: how long today's page takes to show at 390 with 4× CPU slowdown (Chromium), with a 25-row inline table and
// without one. Median of N loads: navigation start until the page's last line is drawn (and, with the table, its 25th
// row). Usage: node tests/evidence/databases/render-budget.mjs <base-url> <store-path> [runs]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/render-budget.mjs <base-url> <store-path> [runs]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), runs = Number(process.argv[4] ?? 7)
const browser = await pw.chromium.launch({ headless: true })
const measure = async (variant) => {
  execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-day-table.ts ${storePath} ${variant}`, { stdio: 'ignore' })
  const times = []
  for (let i = 0; i < runs + 1; i++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const start = Date.now()
    await page.goto(`${base}/`)
    await page.getByText('Line 39 of the day').waitFor({ timeout: 60000 })
    // A chart is drawn when its second bar is, after its code has loaded; a table when its 25th row is.
    if (variant === 'chart') await page.locator('.database-chart-bar').nth(1).waitFor({ timeout: 60000 })
    else if (variant !== 'plain') await page.locator('.database-row').nth(24).waitFor({ timeout: 60000 })
    const ms = Date.now() - start
    if (i > 0) times.push(ms) // the first load warms the dev server's module cache
    await page.close()
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1) }
}
// BUDGET_VARIANTS=relation,todos measures only those, against plain. `cover` isn't in the default set: BUDGET_VARIANTS=table,cover compares a day with a cover to one without.
const variants = (process.env.BUDGET_VARIANTS ?? 'table,linked,chart,todos,relation,formula,sub-items').split(',')
const plain = await measure('plain'), out = { runs, plain }
for (const v of variants) { out[v] = await measure(v); out[`extra_${v}`] = out[v].median - plain.median }
console.log(JSON.stringify(out))
await browser.close()
