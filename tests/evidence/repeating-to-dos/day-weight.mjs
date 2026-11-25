// What repeats cost a day at 390, with 4× CPU slowdown as R1-18 measures it, in Chromium. Median of N opens, from navigation:
// words = the day's last line drawn; typed = a letter typed on a line shows; tick = line 0 ticked until its save is answered (it repeats, when
// the store has repeats); plainTick = line 25 ticked the same way (it never repeats), on the same page after the first tick.
// The store is seeded again before every open, because a tick changes it.
// Usage: node tests/evidence/repeating-to-dos/day-weight.mjs <base-url> <store-path> <repeating> [runs]
//   (the server at <base-url> uses the throwaway store at <store-path>; <repeating> is how many of lines 0 to 24 repeat, 0 for none)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, repeating, runs = '5'] = process.argv.slice(2)
if (!base || !S || repeating === undefined) { console.error('Usage: node tests/evidence/repeating-to-dos/day-weight.mjs <base-url> <store-path> <repeating> [runs]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const browser = await pw.chromium.launch({ headless: true })
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const all = { words: [], typed: [], tick: [], plainTick: [] }
const ticked = async (page, line) => {
  const box = page.locator(`[data-id="${line}"] input[type=checkbox]`), start = Date.now()
  const answered = page.waitForResponse(r => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('task-status'), { timeout: 120000 })
  await box.tap(); await answered
  return Date.now() - start
}
for (let i = 0; i < Number(runs); i++) {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/repeating-to-dos/weight-seed.ts ${S} ${today} ${repeating}`, { stdio: 'ignore' })
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
  all.tick.push(await ticked(page, 'line-0'))
  all.plainTick.push(await ticked(page, 'line-25'))
  await context.close()
}
await browser.close()
console.log(JSON.stringify({ repeating: Number(repeating), runs: Number(runs), words: median(all.words), typed: median(all.typed), tick: median(all.tick), plainTick: median(all.plainTick), all }))
