// G8-9 (Lead cdc31250): typing in a line above a Map block that's in view on open, while the map loads, against the
// same day page with no map. Keypress-to-paint: from each keydown to the next frame after it, median and worst, over
// every key of N loads; plus when the page and the map were drawn. 1280, Chromium with SwiftShader for WebGL2.
// Usage: node tests/evidence/map/typing.mjs <base-url> <store-path> [loads]   (the server on that store; it's reseeded)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, store, loadsArg] = process.argv.slice(2), loads = Number(loadsArg ?? 5)
if (!base || !store) { console.error('Usage: node tests/evidence/map/typing.mjs <base-url> <store-path> [loads]'); process.exit(2) }
const browser = await pw.chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
for (const variant of ['plain', 'map-top']) {
  execSync(`rm -f ${store} && node --no-warnings tests/evidence/databases/seed-day-table.ts ${store} ${variant}`, { stdio: 'ignore' })
  const lat = [], drawn = [], mapDrawn = [], whileLoading = []
  for (let i = 0; i < loads + 1; i++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      window.__lat = []
      document.addEventListener('keydown', e => { const t0 = e.timeStamp; requestAnimationFrame(() => window.__lat.push(performance.now() - t0)) }, true)
    })
    const start = Date.now()
    await page.goto(`${base}/`)
    await page.getByText('Line 1 of the day').waitFor({ timeout: 60000 })
    const pageAt = Date.now() - start
    // Straight into the line above the block, typing while the map is still on its way.
    await page.getByText('Line 1 of the day').click(); await page.keyboard.press('End')
    const loadingAtStart = variant === 'map-top' ? await page.locator('.map-frame.is-ready').count() === 0 : null
    await page.keyboard.type(' typing while it loads', { delay: 40 })
    if (variant === 'map-top') { await page.locator('.map-frame.is-ready').waitFor({ timeout: 60000 }); if (i > 0) { mapDrawn.push(Date.now() - start); whileLoading.push(loadingAtStart) } }
    if (i > 0) { drawn.push(pageAt); lat.push(...await page.evaluate(() => window.__lat)) }
    await page.close()
  }
  const med = xs => pct(xs, 0.5)
  console.log(JSON.stringify({ variant, loads, pageDrawn: med(drawn), ...(mapDrawn.length ? { mapDrawn: med(mapDrawn), typingStartedBeforeMap: `${whileLoading.filter(Boolean).length}/${whileLoading.length}` } : {}), keys: lat.length, keyToPaintMedian: med(lat), keyToPaintP95: pct(lat, 0.95), keyToPaintWorst: Math.round(Math.max(...lat)) }))
}
await browser.close()
