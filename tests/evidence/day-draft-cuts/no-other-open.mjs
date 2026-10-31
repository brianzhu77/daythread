// Lead e1158869 / Bumblebee efb90b83: today's strip has no "N other open tasks" line. Run on a store with open to-dos
// planned for earlier days (the v1 fixture plus scripts/align-fixtures.ts). Usage: node no-other-open.mjs <base>.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) {
  const b = await br.launch(); const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(600)
  const facts = (await p.locator('.facts').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(!/other open task/.test(facts), `${name} ${w}: no "other open tasks" line (strip: "${facts}")`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
