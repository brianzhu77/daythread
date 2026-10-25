// B27 rollback rehearsal (Lead dee40862): the build from before B27 on a store that has date chips. Before
// scripts/rollback-b27-chips.ts every page with a chip fails to open; after it, every page opens with the chip's text.
// Read-only. Built old server on a copy of a store made by seed.ts:
//   node tests/evidence/b27/rollback-check.mjs <base> <broken|ok> [webkit|chromium]
import * as pw from '@playwright/test'
const [base, expect, engine = 'webkit'] = process.argv.slice(2)
if (!base || !['broken', 'ok'].includes(expect) || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('usage: <base> <broken|ok> [engine]')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const prev = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const pages = { [prev(2)]: ['PAC Lunch @Nov 20 12pm', 'Dentist @Oct 24 3pm'.replace('Oct 24', new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))], [prev(1)]: ['Bake sale at school @'], [today]: ['Call the plumber @'] }
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine} ${expect}: ${what}${detail ? ` (${detail})` : ''}`) }
const browser = await pw[engine].launch()
for (const width of [1280, 390]) {
  const p = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } })
  for (const [date, wanted] of Object.entries(pages)) {
    await p.goto(`${base}/day/${date}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
    const body = await p.evaluate(() => document.body.innerText)
    const broken = /Something went wrong/.test(body)
    const lines = await p.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-inline-content')].map(e => e.textContent))
    if (expect === 'broken') log(broken, `${width} ${date}: the old build can't open the page`)
    else log(!broken && wanted.every(w => lines.some(l => l?.startsWith(w))), `${width} ${date}: opens, with the chips as text`, JSON.stringify(lines.filter(l => /@/.test(l ?? ''))))
  }
  await p.close()
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
