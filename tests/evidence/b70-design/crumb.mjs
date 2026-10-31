import { webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const w = await webkit.launch(); const base = 'http://127.0.0.1:3654'
const m = () => { const a = document.querySelector('.crumb'); const r = document.createRange(); r.selectNodeContents(a); const t = r.getBoundingClientRect(); const box = a.getBoundingClientRect(); return { box: [box.left, box.top, box.height], text: [t.left, t.top], title: document.querySelector('[aria-label="Page title"], .large-title').getBoundingClientRect().top } }
for (const url of ['/pages', '/pages?view=templates']) {
  const q = await w.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await q.goto(base + url); await q.waitForTimeout(900)
  await q.locator('.card-row').first().tap(); await q.waitForTimeout(1200)
  console.log(url, JSON.stringify(await q.evaluate(m)))
  await q.close()
}
await w.close()
