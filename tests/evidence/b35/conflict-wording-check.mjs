// B35 part 3: the conflict line names where the change came from: another tab of this browser, or another device.
// Built server, sign-in off, fresh SQLite:   node tests/evidence/b35/conflict-wording-check.mjs <base>
import { chromium } from '@playwright/test'
const [BASE] = process.argv.slice(2), mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const b = await chromium.launch()
let failed = 0; const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} 1280: ${what}${d ? ` (${d})` : ''}`) }
const typeInNotes = async (p, text) => {
  const h = await p.locator('h2', { hasText: 'Notes' }).first().boundingBox()
  await p.mouse.click(h.x + 60, h.y + h.height + 18); await p.waitForTimeout(200); await p.keyboard.press(`${mod}+ArrowRight`)
  if (await p.evaluate(() => (window.getSelection()?.anchorNode?.textContent ?? '').trim().length > 0)) await p.keyboard.press('Enter')
  await p.keyboard.type(text); await p.waitForTimeout(800)
}
async function scenario(sameBrowser, label, expected) {
  const one = await b.newContext({ viewport: { width: 1280, height: 900 } }), two = sameBrowser ? one : await b.newContext({ viewport: { width: 1280, height: 900 } })
  const a = await one.newPage(), c = await two.newPage()
  for (const p of [a, c]) { await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600) }
  const block = r => r.request().method() === 'POST' ? r.abort('failed') : r.continue()
  await c.route('**/_serverFn/**', block); await typeInNotes(c, `${label} unsaved here`)
  await typeInNotes(a, `${label} saved there`); await a.waitForTimeout(1200)
  await c.unroute('**/_serverFn/**', block); await c.waitForTimeout(7000)
  const line = await c.locator('.editor-save-line').innerText().catch(() => '')
  log(line.includes(expected) && line.includes('Load latest'), `${label}: "${expected}"`, line.replace(/\n/g, ' · '))
  await one.close(); if (!sameBrowser) await two.close()
}
await scenario(true, 'two tabs', 'Changed in another tab')
await scenario(false, 'two devices', 'Changed on another device')
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
