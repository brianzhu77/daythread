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
const childAt = labels.findIndex(l => /^Add Child of top to .*Top 3/.test(l)), parentAt = labels.findIndex(l => /^Add Parent top to .*Top 3/.test(l))
log(childAt > parentAt && parentAt >= 0, 'a sub-task under a Top 3 row is offered into Top 3, right after its parent (Bumblebee 8ea1b2fc)', JSON.stringify(labels))
// Add all: three top-level Top 3 items (Carried top, Parent top, Dragged up) and one sub-task under Parent top. The
// sub-task takes no slot, so all four land in Top 3 with nothing pushed out (Bumblebee df6f0a08, Lead 6999454f).
await p.locator('.mc-add-all').click(); await p.waitForTimeout(2000)
const section = name => p.evaluate(n => { const h = [...document.querySelectorAll('h2')].find(e => e.textContent.includes(n)); const out = []; let x = h?.closest('[data-node-type="blockOuter"]')?.nextElementSibling; while (x && !x.querySelector('h2')) { const t = x.querySelector('.editor-task-title')?.textContent; if (t) out.push(t); x = x.nextElementSibling } return out }, name)
const top3 = await section('Top 3'), other = await section('Other')
log(JSON.stringify(top3) === JSON.stringify(['Carried top', 'Parent top', 'Child of top', 'Dragged up']), 'Add all: the three Top 3 items and the sub-task right after its parent, nothing pushed out', JSON.stringify(top3))
log(JSON.stringify(other) === JSON.stringify(['Carried other']), 'Other stays Other', JSON.stringify(other))
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
