import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const url = 'http://127.0.0.1:3662/day/2026-12-31'
for (const [name, br, width, height] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) {
  const b = await br.launch(); const rects = {}
  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width, height }, colorScheme: scheme, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
    await p.goto(url); await p.waitForSelector('.editor-task input'); await p.waitForTimeout(1000)
    rects[scheme] = await p.evaluate(() => [...document.querySelectorAll('.editor-task input')].map(i => { const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: r.width, h: r.height, bg: cs.backgroundColor, checked: i.checked } }))
    const first = await p.locator('.editor-task').first(); await first.scrollIntoViewIfNeeded()
    const box = await p.locator('.bn-editor').boundingBox()
    await p.screenshot({ path: `/tmp/jazz-cb-run/${name}-${scheme}.png`, clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y), width: Math.min(560, width - box.x + 10), height: 360 } })
    await p.close()
  }
  const L = rects.light, D = rects.dark
  ok(L.length === D.length && L.every((r, i) => Math.abs(r.x - D[i].x) <= 0.5 && Math.abs(r.y - D[i].y) <= 0.5 && r.w === D[i].w && r.h === D[i].h), `${name} ${width}: ${L.length} boxes at the same place and size in light and dark`)
  const emptyDark = D.filter(r => !r.checked), doneDark = D.filter(r => r.checked)
  ok(emptyDark.every(r => r.bg === 'rgba(0, 0, 0, 0)'), `${name}: empty boxes have no fill in dark (${emptyDark.length})`)
  ok(doneDark.length > 0 && doneDark.every(r => r.bg !== 'rgba(0, 0, 0, 0)'), `${name}: ticked boxes are filled blue in dark (${doneDark.length})`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
