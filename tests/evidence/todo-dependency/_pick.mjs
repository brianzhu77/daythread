import * as pw from '@playwright/test'
const [base, engine, width] = process.argv.slice(2)
const b = await pw[engine].launch(); const p = await (await b.newContext({ viewport: { width: +width, height: 800 }, hasTouch: +width < 500 })).newPage()
await p.goto(`${base}/`); await p.waitForTimeout(2400)
const row = t => p.locator('.editor-task', { has: p.locator('.editor-task-title', { hasText: new RegExp(`^${t}`) }) }).first()
if (+width < 500) { await row('Bravo').locator('.bn-inline-content').tap(); await p.waitForTimeout(150); await p.locator('.editor-touch-handle').tap(); await p.waitForTimeout(300); await p.locator('.editor-selection-bar [aria-label="More actions"]').tap() }
else { await row('Bravo').hover(); await row('Bravo').locator('.editor-row-more').click() }
await p.waitForTimeout(250); await p.getByRole('menuitem', { name: /^Blocked by/ }).click(); await p.waitForTimeout(500)
console.log(JSON.stringify(await p.locator('.property-options [role=option]').evaluateAll(els => els.map(e => [e.textContent, Math.round(e.getBoundingClientRect().right), e.querySelector('.property-why') ? Math.round(e.querySelector('.property-why').getBoundingClientRect().right) : null]))))
await p.screenshot({ path: `/tmp/rb-csv/dep-pick-${engine}-${width}.png` }); await b.close()
