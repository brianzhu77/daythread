// G6-8's browser half: the floor build serving a store with a dashboard draws its view as a table of the host's rows,
// with no page errors, and keeps every other page working.
// Usage: node tests/evidence/dashboard/floor-draw.mjs <floor-base-url> [shots-dir]  (the floor server on a store from seed.ts)
import * as pw from '@playwright/test'
const [base, shots] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/floor-draw.mjs <floor-base-url> [shots-dir]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pages?page=home`); await page.locator('.database-block').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500)
  ok(`${engine} floor: Home's dashboard view draws as a table`, await page.locator('.database-table-wrap, table').count() > 0 && await page.locator('.dashboard-widget').count() === 0, await page.locator('[data-database-views]').first().innerText().catch(() => ''))
  if (shots) await page.screenshot({ path: `${shots}/floor-${engine}.png` })
  await page.goto(`${base}/pages?page=runs`); await page.getByText('Alpha', { exact: true }).waitFor({ timeout: 20000 })
  ok(`${engine} floor: a widget's source opens as ever`, await page.getByText('Charlie', { exact: true }).isVisible())
  ok(`${engine} floor: no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
