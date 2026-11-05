// B87 14: what photos cost a day at 390, with 4× CPU slowdown as R1-18 measures it, in Chromium. Median of N opens, from navigation:
// words = the day's last line drawn; typed = a letter typed on a line shows; photo = the first picture is in. `cold` is a new browser profile, `again` is a second open in the same one.
// Usage: node tests/evidence/body-files/day-weight.mjs <base-url> <store-path> <files-folder> <photo.jpg> [runs]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, store, folder, photo, runs = '5'] = process.argv.slice(2)
if (!base || !store || !folder || !photo) { console.error('Usage: node tests/evidence/body-files/day-weight.mjs <base-url> <store-path> <files-folder> <photo.jpg> [runs]'); process.exit(2) }
const networks = { local: null, '4G': { offline: false, latency: 60, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 } }
const browser = await pw.chromium.launch({ headless: true })
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const open = async (page, photos, lineNo) => {
  const start = Date.now(), times = {}
  const words = page.getByText('Line 39 of the day')
  await page.goto(`${base}/`)
  await words.waitFor({ timeout: 120000 })
  times.words = Date.now() - start
  const line = page.locator(`[data-id="line-${lineNo}"] .bn-inline-content`)
  await line.click({ timeout: 120000 })
  await page.keyboard.type('x')
  await page.waitForFunction(([no]) => document.querySelector(`[data-id="line-${no}"] .bn-inline-content`)?.textContent.includes('x'), [lineNo], { timeout: 120000 })
  times.typed = Date.now() - start
  if (photos) { await page.waitForFunction(() => { const i = document.querySelector('.bn-visual-media'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 180000 }); times.photo = Date.now() - start }
  return times
}
const seed = photos => execSync(`rm -rf ${store} ${store}-wal ${store}-shm ${folder} && node --no-warnings tests/evidence/body-files/seed-day-photos.ts ${store} ${folder} ${photo} ${photos}`, { stdio: 'ignore' })
for (const photos of [0, 1, 4]) for (const [net, conditions] of Object.entries(networks)) {
  const cold = [], again = []
  for (let i = 0; i <= Number(runs); i++) {
    seed(photos)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false, serviceWorkers: 'block' }), page = await context.newPage(), cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    if (conditions) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', conditions) }
    const c = await open(page, photos, 1)
    await page.waitForTimeout(1500)
    const a = await open(page, photos, 2)
    if (i > 0) { cold.push(c); again.push(a) } // the first warms the server
    await context.close()
  }
  const line = list => Object.fromEntries(Object.keys(list[0]).map(k => [k, median(list.map(t => t[k]))]))
  console.log(JSON.stringify({ photos, net, cold: line(cold), again: line(again) }))
}
await browser.close()
