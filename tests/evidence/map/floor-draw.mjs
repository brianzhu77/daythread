// G8-12's browser half: the floor build serving a store with a Map view draws it as a table of its rows, with no page
// errors, and loads no map code.
// Usage: node tests/evidence/map/floor-draw.mjs <floor-base-url>  (the floor server on a store from seed.ts)
import * as pw from '@playwright/test'
const [base] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/map/floor-draw.mjs <floor-base-url>'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = [], outside = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()) })
  await page.goto(`${base}/pages?page=eats`); await page.getByText('Golden Dumpling', { exact: true }).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1200)
  ok(`${engine} floor: a Map view draws as a table of its rows`, await page.locator('table, .database-table-wrap').count() > 0 && await page.getByText('Stanley Park', { exact: true }).first().isVisible(), await page.locator('[data-database-views]').first().innerText().catch(() => ''))
  ok(`${engine} floor: no map code, nothing asked outside, no page errors`, outside.length === 0 && errors.length === 0, `${outside.length} outside · ${errors.join(' | ').slice(0, 200)}`)
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
