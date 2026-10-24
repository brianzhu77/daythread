// B40: another device changed the page while the draft waited; two tabs holding one gone tab's draft. Usage: node b40more.mjs <port>
const pw = await import('playwright')
const port = process.argv[2], base = `http://127.0.0.1:${port}`
const b = await pw.chromium.launch(); const errors = []; const log = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
const saveRoute = (pg, mode) => pg.route('**/*', r => (mode.v === 'block' && r.request().method() === 'POST' && (r.request().postData() ?? '').includes('save-editor')) ? r.abort('failed') : r.continue())
const typeAt = async (pg, anchor, t) => { await pg.getByText(anchor).first().click(); await pg.keyboard.press('Meta+ArrowRight'); await pg.keyboard.press('Enter'); await pg.keyboard.type(t) }
const lines = pg => pg.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-inline-content')].map(e => e.textContent).filter(Boolean))
const line = pg => pg.evaluate(() => document.querySelector('.editor-unsaved-line.is-elsewhere')?.textContent ?? null)
// C. another device edits the page while this tab's draft waits
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message))
const mode = { v: 'block' }; await saveRoute(p, mode)
await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const mine = 'mine' + (Date.now() % 1000); await typeAt(p, '#daythread feedback', mine); await p.waitForTimeout(1500)
await p.locator('.sidebar .side-row:has-text("Pages")').first().click(); await p.waitForTimeout(2500); log('C: kept', await line(p))
const other = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await other.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await other.waitForTimeout(1000)
const theirs = 'theirs' + (Date.now() % 1000); await typeAt(other, 'paste link to page is good', theirs); await other.waitForTimeout(2500)
log('C: other device saved', await other.evaluate(() => document.querySelector('.editor-save-line')?.textContent)); await other.close()
mode.v = 'ok'; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(5000); log('C: line after retry', await line(p))
await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
const ls = await lines(p); log('C: copies mine/theirs', [ls.filter(t => t.includes(mine)).length, ls.filter(t => t.includes(theirs)).length]); log('C: status', await p.evaluate(() => document.querySelector('.editor-save-line')?.textContent))
await ctx.close()
// D. two tabs both hold a closed tab's draft: it's saved once
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } })
const k1 = await ctx2.newPage(), k2 = await ctx2.newPage(); for (const k of [k1, k2]) { k.on('pageerror', e => errors.push(e.message)); await k.goto(base + '/tasks', { waitUntil: 'networkidle' }) }
const gone = await ctx2.newPage(); const gm = { v: 'block' }; await saveRoute(gone, gm)
await gone.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await gone.waitForTimeout(1000)
const once = 'once' + (Date.now() % 1000); await typeAt(gone, '#daythread feedback', once); await gone.waitForTimeout(1500); await gone.close({ runBeforeUnload: true })
await Promise.all([k1, k2].map(k => k.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')) })))
await k1.waitForTimeout(6000); log('D: lines left', [await line(k1), await line(k2)])
await k1.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await k1.waitForTimeout(1500)
log('D: copies of the closed tab text', (await lines(k1)).filter(t => t.includes(once)).length)
console.log('errors:', errors.length ? errors.join(' | ') : 'none'); await b.close()
