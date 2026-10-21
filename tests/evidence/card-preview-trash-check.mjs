// Ratchet: a trashed page's contents never show under its card on another page.
// Deletes 韩国大酱汤 through its page menu (moves it to Trash) on a copy of Brian's data, then opens Oct 18.
//   node card-preview-trash-check.mjs <base url> <playwright index.mjs>
const [base, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
await p.goto(`${base}/pages?page=fa95e8a3-dd0a-4b3c-8fcc-c1129c8c4820`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
await p.locator('.page-more').first().click(); await p.getByRole('menuitem', { name: 'Delete' }).click(); await p.waitForTimeout(1200)
await p.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
const cards = await p.locator('.editor-page-card').evaluateAll(es => es.map(e => ({ trash: e.classList.contains('in-trash'), preview: e.querySelector('.editor-page-card-preview')?.textContent ?? null })))
const ok = cards.length === 2 && cards[0].trash && cards[0].preview === null && !cards[1].trash && cards[1].preview === '#recipe'
console.log(`${ok ? 'ok  ' : 'FAIL'} the trashed page's card shows no preview; the other card keeps its own · ${JSON.stringify(cards)}`)
if (!ok) process.exitCode = 1
await b.close()
