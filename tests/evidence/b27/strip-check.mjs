// B27 (Jazz b27-at-date-states §3d): today's events as one line, first in the facts strip; a tap jumps to the rows.
// Built server on a fresh store made by seed.ts (read-only here):
//   node tests/evidence/b27/strip-check.mjs <base> <out dir> [webkit|chromium]
import * as pw from '@playwright/test'
const [base, out, engine = 'webkit'] = process.argv.slice(2)
if (!base || !out || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine}: ${what}${detail ? ` (${detail})` : ''}`) }
const browser = await pw[engine].launch()
for (const width of [1280, 390]) {
  const phone = width === 390
  const p = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone })
  await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.click()
  const line = p.locator('.facts .today-events')
  const info = await p.evaluate(() => {
    const el = document.querySelector('.facts .today-events'), facts = document.querySelector('.facts')
    const r = el?.getBoundingClientRect(), range = document.createRange()
    if (el) range.selectNodeContents(el.querySelector('.today-events-text'))
    const tops = new Set([...range.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)))
    return el && { text: el.textContent, first: facts.firstElementChild === el, oneLine: tops.size === 1, inside: r.right <= innerWidth, wide: document.documentElement.scrollWidth <= innerWidth, top: r.top }
  })
  log(info?.text === 'Bake sale at school · 9:30 AM Call the plumber\u00a0· +1 more▸', `${width}: the line reads the day's events in row order`, JSON.stringify(info?.text))
  log(info?.first, `${width}: first in the strip`)
  log(info?.oneLine && info.inside && info.wide, `${width}: one line, inside the page, nothing wider than the screen`, JSON.stringify(info))
  log(info && info.top < (phone ? 844 : 900), `${width}: above the fold`, String(info?.top))
  await p.screenshot({ path: `${out}/strip-${width}.png`, clip: { x: 0, y: 0, width, height: phone ? 500 : 420 } })
  if (phone) await line.tap(); else await line.click()
  await p.waitForTimeout(500)
  const jumped = await p.evaluate(() => { const r = document.querySelector('.event-rows'); const b = r?.getBoundingClientRect(); return r && { flash: r.classList.contains('block-flash'), visible: b.top >= 0 && b.bottom <= innerHeight } })
  log(jumped?.flash && jumped.visible, `${width}: a tap brings the rows into view and flashes them`, JSON.stringify(jumped))
  await p.goto(`${base}/day/2026-10-23`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  log(!(await p.locator('.facts .today-events').count()), `${width}: no line on another day`)
  await p.close()
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
