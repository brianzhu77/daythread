// What a Feed of 25 cards costs at 390 with 4× CPU slowdown (feed.md §6), in Chromium: median of N opens, from navigation to the
// 25th card's body drawn, against the same 25 rows as a table. Usage: node tests/evidence/feed/weight.mjs <base-url> <store-path> [runs]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, runs = '7'] = process.argv.slice(2)
const browser = await pw.chromium.launch({ headless: true })
const measure = async layout => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/feed/weight-seed.ts ${S} ${layout}`, { stdio: 'ignore' })
  const times = []
  for (let i = 0; i <= Number(runs); i++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const start = Date.now()
    await page.goto(`${base}/pages?page=reading`)
    await page.locator(layout === 'feed' ? '.feed-card .feed-body' : '.database-row').nth(24).waitFor({ timeout: 60000 })
    if (i > 0) times.push(Date.now() - start)
    await page.close()
  }
  times.sort((a, b) => a - b)
  return { median: times[times.length >> 1], min: times[0], max: times.at(-1) }
}
const table = await measure('table'), feed = await measure('feed')
console.log(JSON.stringify({ runs: Number(runs), table, feed, extra: feed.median - table.median }))
await browser.close()
