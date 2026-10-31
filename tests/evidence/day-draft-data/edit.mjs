import { webkit, chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await webkit.launch()
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Vancouver' })
const p = await ctx.newPage()
await p.goto(`${base}/day/2026-10-31`); await p.waitForSelector('.draft-band', { timeout: 60000 })
const bands = await p.locator('.draft-band').allTextContents(); console.log(JSON.stringify(bands))
const newBand = p.locator('.draft-band').filter({ hasNotText: /Lisbon|passport/ }).first()
const text = newBand.locator('.draft-text')
await text.click()
await text.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
await p.keyboard.type('My edited suggestion')
console.log('band now:', JSON.stringify(await text.textContent()))
await p.getByRole('button', { name: 'Apply all' }).tap(); await p.waitForTimeout(2500)
const tasks = await p.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type=task]')].map(e => (e.textContent || '').replace('⋯', '').trim()).filter(Boolean))
console.log(JSON.stringify(tasks))
ok(tasks.includes('My edited suggestion') && !tasks.some(t => /tax/i.test(t)), 'Apply all applies the edited words')
await b.close(); process.exitCode = fail ? 1 : 0
