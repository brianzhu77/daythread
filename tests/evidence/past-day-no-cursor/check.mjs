// A past day opens with no cursor, so no empty row shows until he clicks into a section (Jazz, Bumblebee, Lead).
// Fixture as in tests/evidence/stray-line/past-day-check.mjs (today's page with "past task", moved to Oct 20).
//   node tests/evidence/past-day-no-cursor/check.mjs <base url> [today: also check today on this server]
import { chromium } from '@playwright/test'
const BASE = process.argv[2] ?? 'http://127.0.0.1:3490', checkToday = process.argv[3] === 'today'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? ` (${d})` : ''}`) }
const emptyShown = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(o => {
  const c = o.querySelector('.bn-block-content'); return o.getClientRects().length > 0 && c?.getAttribute('data-content-type') !== 'heading' && !(c?.textContent ?? '').replace('⋯', '').trim()
}).map(o => o.getAttribute('data-id')))
const focused = () => p.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))
if (!checkToday) {
  await p.goto(`${BASE}/day/2026-10-20`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  log(!(await focused()), 'a past day opens with no cursor')
  log((await emptyShown()).length === 0, 'and shows no empty rows', (await emptyShown()).join(','))
  const h = await p.locator('h1, h2, h3', { hasText: 'TODO - Other' }).first().boundingBox(); await p.mouse.click(h.x + 20, h.y + h.height / 2); await p.waitForTimeout(400)
  const shown = await emptyShown()
  log(shown.length === 1 && shown[0].includes(':other:'), 'clicking "TODO - Other" shows its empty row', shown.join(','))
} else {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  log(await focused(), 'today still opens with the cursor in place')
}
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
