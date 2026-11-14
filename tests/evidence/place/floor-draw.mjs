// G8-8's browser half: the floor build serving a store with Place values draws the database with no page errors, its
// rows all there, and keeps a day page working.
// Usage: node tests/evidence/place/floor-draw.mjs <floor-base-url>  (the floor server on a store from seed.ts)
import * as pw from '@playwright/test'
const [base] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/place/floor-draw.mjs <floor-base-url>'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pages?page=eats`); await page.getByText('Dumplings', { exact: true }).waitFor({ timeout: 20000 }); await page.waitForTimeout(1200)
  ok(`${engine} floor: a database with a Place column draws, every row there`, await Promise.all(['Dumplings', 'Ramen', 'Tea', 'Lake'].map(t => page.getByText(t, { exact: true }).isVisible())).then(x => x.every(Boolean)), await page.locator('th').allInnerTexts().then(x => x.join(' | ')))
  const day = new Date().toLocaleDateString('en-CA')
  await page.goto(`${base}/day/${day}`)
  const editor = await page.locator('[contenteditable=true]').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  ok(`${engine} floor: a day page opens as ever`, editor, page.url())
  ok(`${engine} floor: no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
