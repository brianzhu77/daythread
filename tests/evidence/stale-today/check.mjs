// A screen left open across days (B46). Fake clock, disposable store, sign-in off. Three cases at 1280 Chromium and
// 390 WebKit:
//   resumed: open on Oct 21, come back on Oct 23 (visibilitychange + focus) -> Today and the day page move to Oct 23;
//   short trip: input at 23:55 Oct 23, back at 00:01 -> stays Oct 23; 11 more idle minutes -> Oct 24, focus released;
//   overnight: visible from 22:00 with no return event at all -> Oct 24 by 00:15.
//   node tests/evidence/stale-today/check.mjs <base>
import { chromium, webkit } from '@playwright/test'

const base = process.argv[2]
if (!base) { console.error('usage: node tests/evidence/stale-today/check.mjs <base>'); process.exit(2) }
const at = iso => new Date(iso)
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

for (const [engine, width] of [[chromium, 1280], [webkit, 390]]) {
  const browser = await engine.launch()
  const run = async (name, start, body) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'America/Vancouver' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.clock.install({ time: at(start) })
    const title = () => page.locator('.day-title-date').first().innerText()
    const relative = () => page.locator('.relative-day').first().innerText().catch(() => '')
    const comeBack = () => page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
    await body({ page, title, relative, comeBack, name: `${width} ${name}` })
    check(`${width} ${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await context.close()
  }

  await run('resumed', '2026-10-21T16:00:00Z', async ({ page, title, relative, comeBack, name }) => {
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    check(`${name}: Today opens on Oct 21`, /Oct 21/.test(await title()), await title())
    await page.clock.setSystemTime(at('2026-10-23T16:18:00Z')); await comeBack(); await page.waitForTimeout(500)
    check(`${name}: back on Oct 23, Today shows Oct 23`, /Oct 23/.test(await title()), await title())
    await page.clock.setSystemTime(at('2026-10-21T16:00:00Z'))
    await page.goto(base + '/day/2026-10-21', { waitUntil: 'networkidle' })
    check(`${name}: /day/2026-10-21 on Oct 21 says Today`, /Today/.test(await relative()), await relative())
    await page.clock.setSystemTime(at('2026-10-23T16:18:00Z')); await comeBack(); await page.waitForTimeout(500)
    check(`${name}: back on Oct 23, that page no longer says Today`, !/Today/.test(await relative()), (await relative()) || '(no relative label)')
  })

  await run('short trip', '2026-10-24T06:50:00Z', async ({ page, title, comeBack, name }) => { // 23:50 Oct 23
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.clock.setSystemTime(at('2026-10-24T06:55:00Z'))
    const line = page.locator('.continuous-editor [contenteditable="true"]').first()
    await line.click(); await page.keyboard.press('Shift')
    await page.clock.setSystemTime(at('2026-10-24T07:01:00Z')); await comeBack(); await page.waitForTimeout(500)
    check(`${name}: back at 00:01 after input at 23:55, still Oct 23`, /Oct 23/.test(await title()), await title())
    await page.clock.runFor(11 * 60_000); await page.waitForTimeout(500)
    check(`${name}: 11 idle minutes later, Oct 24`, /Oct 24/.test(await title()), await title())
    const inEditor = await page.evaluate(() => Boolean(document.activeElement?.closest('.continuous-editor')))
    check(`${name}: the editor's focus was released`, !inEditor)
  })

  await run('overnight', '2026-10-24T05:00:00Z', async ({ page, title, name }) => { // 22:00 Oct 23
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.clock.runFor(2 * 60 * 60_000 + 15 * 60_000); await page.waitForTimeout(500)
    check(`${name}: visible overnight with no return event, Oct 24 by 00:15`, /Oct 24/.test(await title()), await title())
  })
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
