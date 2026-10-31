import { webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await webkit.launch()
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Vancouver' })
const p = await ctx.newPage()
const tasks = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type=task]')].map(e => (e.textContent || '').replace('⋯', '').trim()).filter(Boolean))
const words = () => p.evaluate(() => (document.querySelector('.continuous-editor')?.textContent || ''))
await p.goto(`${base}/day/2026-10-31`); await p.waitForSelector('.draft-band', { timeout: 60000 })
const n = await p.locator('.draft-band').count()
// Type on the page (the last empty line of the reflection), then Apply all at once.
await p.locator('.bn-block-content[data-content-type=paragraph]').last().click()
await p.keyboard.type('typed just now')
await p.getByRole('button', { name: 'Apply all' }).click(); await p.waitForTimeout(2500)
const applied = await tasks()
console.log('after Apply all:', JSON.stringify(applied))
await p.getByRole('button', { name: 'Undo' }).last().click(); await p.waitForTimeout(2500)
const after = await tasks(), bands = await p.locator('.draft-band').count()
console.log('after Undo:', JSON.stringify(after), 'bands', bands)
ok(after.length === 0 && bands === n, `Undo: the editor drops the applied rows and the ${n} bands come back`)
ok((await words()).includes('typed just now'), 'his typing is kept')
await p.reload(); await p.waitForSelector('.continuous-editor'); await p.waitForTimeout(1500)
ok(JSON.stringify(await tasks()) === JSON.stringify(after) && (await words()).includes('typed just now'), 'reload shows the same thing')
await b.close(); process.exitCode = fail ? 1 : 0
