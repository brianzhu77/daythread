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
    if (variant === 'table') await page.locator('.database-row').nth(24).waitFor({ timeout: 60000 })
    const ms = Date.now() - start
    if (i > 0) times.push(ms) // the first load warms the dev server's module cache
    await page.close()
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1) }
}
const plain = await measure('plain'), table = await measure('table')
console.log(JSON.stringify({ runs, plain, table, extra: table.median - plain.median }))
await browser.close()
