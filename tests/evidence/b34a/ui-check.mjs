// B34a: the morning card offers yesterday's Top 3 rows into Top 3 and Other rows into Other. Built server, sign-in
// off, a store seeded by tests/evidence/b34a/seed.ts:   node tests/evidence/b34a/ui-check.mjs <base> [width]
import { chromium } from '@playwright/test'
const [BASE, W] = process.argv.slice(2), width = Number(W ?? 1280)
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width, height: 900 } })).newPage()
let failed = 0; const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${d ? ` (${d})` : ''}`) }
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const labels = await p.locator('[aria-label^="Add "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
log(labels.some(l => /^Add Carried top to .*Top 3/.test(l)), 'a Top 3 row is offered into Top 3', JSON.stringify(labels))
log(labels.some(l => /^Add Dragged up to .*Top 3/.test(l)), 'a row dragged into Top 3 is offered into Top 3')
log(labels.some(l => /^Add Carried other to .*Other/.test(l)), 'an Other row is offered into Other')
await p.locator('[aria-label^="Add Carried top"]').click(); await p.waitForTimeout(1500)
const top3 = await p.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(e => e.textContent.includes('Top 3')); const out = []; let n = h?.closest('[data-node-type="blockOuter"]')?.nextElementSibling; while (n && !n.querySelector('h2')) { out.push(n.textContent); n = n.nextElementSibling } return out.join(' | ') })
log(top3.includes('Carried top'), 'adding it puts it in today\'s Top 3', top3)
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
