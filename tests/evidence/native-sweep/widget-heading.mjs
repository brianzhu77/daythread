// A dashboard widget's heading names its source and opens it, with no "↳ from" line repeating the name (Lead 7499568b).
// Usage: node tests/evidence/native-sweep/widget-heading.mjs <base-url> [chromium|webkit]  (the server on a store fresh from tests/evidence/dashboard/seed.ts)
import * as pw from '@playwright/test'
const [base, engine = 'chromium'] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/evidence/native-sweep/widget-heading.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const wait = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const ok = (name, pass, detail = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} ${name}${detail ? ` ${detail}` : ''}`) }
const browser = await pw[engine].launch()
for (const [width, phone] of [[1280, false], [390, true]]) {
  const page = await (await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone })).newPage()
  await page.goto(`${base}/pages?page=home`); await page.locator('.dashboard-widget').first().waitFor({ timeout: 20000 }); await wait(1500)
  const heads = await page.locator('.dashboard-widget').evaluateAll(ws => ws.map(w => [w.getAttribute('aria-label'), w.querySelector('.database-title')?.tagName, w.querySelector('.database-title')?.textContent, w.querySelectorAll('.database-source').length]))
  ok(`${width}: no widget shows a "from" line`, heads.every(h => h[3] === 0), JSON.stringify(heads))
  ok(`${width}: each heading is a button naming its source`, heads.every(h => h[1] === 'BUTTON' && h[0].startsWith(`${h[2]} · `)), JSON.stringify(heads))
  const books = page.locator('.dashboard-widget', { has: page.locator('.database-title', { hasText: /^Books$/ }) }).locator('.database-title')
  await (phone ? books.tap() : books.click()); await wait(1500)
  ok(`${width}: a tap on "Books" opens Books`, new URL(page.url()).searchParams.get('page') === 'books', page.url())
  await page.context().close()
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0)
