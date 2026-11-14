// G8-12: the map's speed, measured and stated. At 1280, and at 390 with 4× CPU slowdown (Chromium; WebGL through
// SwiftShader, a software GPU, so slower than a phone's): time to the first drawn map with 100 pins, then for 100, 250,
// 500 and 1000 pins in its clustered source, the time to redraw and the frame rate of a one-second pan.
// Usage: node tests/evidence/map/speed.mjs <base-url> [runs]   (a store from seed.ts; Many has 240 rows)
import * as pw from '@playwright/test'
const [base, runsArg] = process.argv.slice(2), runs = Number(runsArg ?? 3)
if (!base) { console.error('Usage: node tests/evidence/map/speed.mjs <base-url> [runs]'); process.exit(2) }
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const browser = await pw.chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
for (const [label, viewport, rate] of [['1280', { width: 1280, height: 900 }, 1], ['390 at 4×', { width: 390, height: 844 }, 4]]) {
  const first = [], by = {}
  for (let i = 0; i < runs; i++) {
    const page = await browser.newPage({ viewport, ...(label.startsWith('390') ? { hasTouch: true, isMobile: true } : {}) })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    const start = Date.now()
    await page.goto(`${base}/pages?page=many`)
    await page.locator('.map-frame.is-ready').waitFor({ timeout: 60000 })
    await page.locator('.map-canvas').evaluate(el => new Promise(r => el.mapForChecks.loaded() && el.mapForChecks.areTilesLoaded() ? r() : el.mapForChecks.once('idle', r)))
    first.push(Date.now() - start)
    for (const n of [100, 250, 500, 1000]) {
      const t = await page.locator('.map-canvas').evaluate((el, n) => new Promise(resolve => {
        const map = el.mapForChecks
        const features = Array.from({ length: n }, (_, k) => ({ type: 'Feature', properties: { id: `x${k}` }, geometry: { type: 'Point', coordinates: [-123.25 + (k % 40) * 0.004, 49.18 + Math.floor(k / 40) * 0.004] } }))
        map.jumpTo({ center: [-123.17, 49.24], zoom: 12 })
        const t0 = performance.now()
        map.getSource('map-pins').setData({ type: 'FeatureCollection', features })
        map.once('idle', () => {
          const redraw = performance.now() - t0
          let frames = 0, run = true
          const tick = () => { frames++; if (run) requestAnimationFrame(tick) }
          requestAnimationFrame(tick)
          map.panBy([300, 0], { duration: 1000 })
          setTimeout(() => { run = false; resolve({ redraw, fps: frames }) }, 1000)
        })
      }), n)
      ;(by[n] ??= []).push(t)
    }
    await page.close()
  }
  console.log(`${label}: first map with 100 pins ${median(first)} ms (median of ${runs}; tiles from OpenFreeMap included)`)
  for (const [n, xs] of Object.entries(by)) console.log(`${label}: ${n} pins · redraw ${Math.round(median(xs.map(x => x.redraw)))} ms · pan ${median(xs.map(x => x.fps))} fps`)
}
await browser.close()
