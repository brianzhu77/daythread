// A screen left open across days: open Today and Tasks on Oct 21 (fake clock), move the clock to Oct 23 without a
// reload, bring the app back (visibilitychange + focus), and read the day the screen shows. Disposable store, sign-in off.
//   node tests/evidence/stale-today/check.mjs <base>
import { chromium, webkit } from '@playwright/test'

const base = process.argv[2]
if (!base) { console.error('usage: node tests/evidence/stale-today/check.mjs <base>'); process.exit(2) }
const oct21 = new Date('2026-10-21T16:00:00Z'), oct23 = new Date('2026-10-23T16:18:00Z') // 09:00 / 09:18 Vancouver
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

for (const [engine, width] of [[chromium, 1280], [webkit, 390]]) {
  const browser = await engine.launch()
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'America/Vancouver' })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.clock.install({ time: oct21 })
  const comeBack = async () => {
    await page.clock.setSystemTime(oct23)
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
    await page.waitForTimeout(800)
  }

  await page.goto(base + '/', { waitUntil: 'networkidle' })
  const title = () => page.locator('.day-title-date').first().innerText()
  check(`${width}: Today opens on Oct 21`, /Oct 21/.test(await title()), await title())
  await comeBack()
  check(`${width}: back on Oct 23, Today shows Oct 23`, /Oct 23/.test(await title()), await title())

  await page.goto(base + '/day/2026-10-21', { waitUntil: 'networkidle' })
  await page.clock.setSystemTime(oct21)
  await page.reload({ waitUntil: 'networkidle' })
  const relative = () => page.locator('.relative-day').first().innerText().catch(() => '')
  check(`${width}: /day/2026-10-21 on Oct 21 says Today`, /Today/.test(await relative()), await relative())
  await comeBack()
  check(`${width}: back on Oct 23, the same page no longer says Today`, !/Today/.test(await relative()), await relative() || '(no relative label)')
  check(`${width}: no page errors`, errors.length === 0, errors.join(' | '))
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
