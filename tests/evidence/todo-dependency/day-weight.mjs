// What links cost a day at 390, with 4× CPU slowdown as R1-18 measures it, in Chromium. Median of N opens, from navigation:
// words = the day's last line drawn; typed = a letter typed on a line shows; tick = a to-do ticked until its save is answered.
// Usage: node tests/evidence/todo-dependency/day-weight.mjs <base-url> [runs]  (the server's store seeded by weight-seed.ts)
import * as pw from '@playwright/test'
const [base, runs = '5'] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/evidence/todo-dependency/day-weight.mjs <base-url> [runs]'); process.exit(2) }
const browser = await pw.chromium.launch({ headless: true })
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const all = { words: [], typed: [], tick: [] }
for (let i = 0; i < Number(runs); i++) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, serviceWorkers: 'block' }), page = await context.newPage()
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const start = Date.now()
  await page.goto(`${base}/`)
  await page.getByText('Line 39 of the day').waitFor({ timeout: 120000 })
  all.words.push(Date.now() - start)
  const line = page.locator('[data-id="line-30"] .bn-inline-content'), typed = Date.now()
  await line.click(); await page.keyboard.type('x')
  await page.waitForFunction(() => document.querySelector('[data-id="line-30"] .bn-inline-content')?.textContent.includes('x'), null, { timeout: 120000 })
  all.typed.push(Date.now() - typed)
  // A blocker ticked: its save answered, as the server reads the links again.
  const box = page.locator('[data-id="line-0"] input[type=checkbox]'), ticked = Date.now()
  const answered = page.waitForResponse(r => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('task-status'), { timeout: 120000 })
  await box.tap(); await answered
  all.tick.push(Date.now() - ticked)
  await context.close()
}
await browser.close()
console.log(JSON.stringify({ runs: Number(runs), words: median(all.words), typed: median(all.typed), tick: median(all.tick), all }))
