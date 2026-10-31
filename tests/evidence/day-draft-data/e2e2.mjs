import { webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await webkit.launch()
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Vancouver' })
const p = await ctx.newPage()
p.on('pageerror', e => { if (!/access control/.test(e.message)) console.log('pageerror', e.message.slice(0, 160)) })
const tasks = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type=task]')].map(e => (e.textContent || '').replace('⋯', '').trim()).filter(Boolean))
await p.goto(`${base}/day/2026-10-31`); await p.waitForSelector('.continuous-editor'); await p.waitForTimeout(1500)
const bandsBefore = await p.locator('.draft-band').count()
console.log('reload: bands', bandsBefore, 'tasks', JSON.stringify(await tasks()))
ok(bandsBefore === 2, 'after reload the 2 remaining bands are still there (stored with the day)')
await p.getByRole('button', { name: 'Apply all' }).tap(); await p.waitForTimeout(2500)
const after = await tasks()
console.log('after Apply all:', JSON.stringify(after))
ok(after.includes('Book the flights to Lisbon') && after.includes('Renew the passport') && await p.locator('.draft-band').count() === 0, 'Apply all applies both, no bands left')
const undo = p.getByRole('button', { name: 'Undo' }).last()
await undo.tap(); await p.waitForTimeout(2500)
const undone = await tasks()
console.log('after Undo:', JSON.stringify(undone), 'bands', await p.locator('.draft-band').count())
ok(!undone.includes('Book the flights to Lisbon') && await p.locator('.draft-band').count() === 2, 'one Undo takes back both rows and brings both bands back')
await p.reload(); await p.waitForSelector('.continuous-editor'); await p.waitForTimeout(1500)
ok(await p.locator('.draft-band').count() === 2, 'no second model call made new bands on reload (one draft per day)')
await b.close(); process.exitCode = fail ? 1 : 0
