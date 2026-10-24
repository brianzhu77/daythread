// B40: gone-tab notice and open-during-save race. Usage: node b40race.mjs <port>
const pw = await import('playwright')
const port = process.argv[2], base = `http://127.0.0.1:${port}`
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const errors = []; const log = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
const saveRoute = (pg, mode) => pg.route('**/*', async r => { const isSave = r.request().method() === 'POST' && (r.request().postData() ?? '').includes('save-editor'); if (!isSave || mode.v === 'ok') return r.continue(); if (mode.v === 'block') return r.abort('failed'); await new Promise(s => setTimeout(s, 3000)); return r.continue() })
const typeIn = async (pg, t) => { await pg.getByText('PAC Lunch').first().click(); await pg.keyboard.press('End'); await pg.keyboard.type(` ${t}`) }
const toasts = pg => pg.evaluate(() => [...document.querySelectorAll('[data-slot="toast"]')].map(t => t.innerText.replace(/\n/g, ' · ')))
const line = pg => pg.evaluate(() => document.querySelector('.editor-unsaved-line.is-elsewhere')?.textContent ?? null)
if (process.argv[3] !== 'B') { // pass B to run only the open-during-save race
// A. a closed tab's text, saved in the background by the tab left open
const keep = await ctx.newPage(); keep.on('pageerror', e => errors.push('keep: ' + e.message)); await keep.goto(base + '/pages', { waitUntil: 'networkidle' })
const tb = await ctx.newPage(); const mB = { v: 'block' }; await saveRoute(tb, mB)
await tb.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await tb.waitForTimeout(1000)
const markB = 'gone' + (Date.now() % 1000); await typeIn(tb, markB); await tb.waitForTimeout(2000)
await tb.close({ runBeforeUnload: true }); await keep.waitForTimeout(500)
log('A: keep tab line right after B closed', await line(keep))
await keep.bringToFront(); await keep.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await keep.waitForTimeout(5000)
log('A: keep tab line after retry', await line(keep))
await keep.locator('.sidebar .side-row:has-text("Thu, Oct 22"), .sidebar a:has-text("Thu, Oct 22")').first().click(); await keep.waitForTimeout(2000)
log('A: Oct 22 opened in keep: text count', await keep.getByText(markB).count()); log('A: notices', await toasts(keep))
await keep.reload({ waitUntil: 'networkidle' }); await keep.waitForTimeout(1500); log('A: after reload notices (expect none)', await toasts(keep))
}
// B. opening the page while its background save is on its way
const p = await ctx.newPage(); p.on('pageerror', e => errors.push('p: ' + e.message)); const mP = { v: 'block' }; await saveRoute(p, mP)
await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const markP = 'race' + (Date.now() % 1000); await typeIn(p, markP); await p.waitForTimeout(2000)
await p.locator('.sidebar .side-row:has-text("Pages")').first().click(); await p.waitForTimeout(3000); log('B: on Pages', await line(p))
mP.v = 'slow'; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(400)
await p.locator('.sidebar a:has-text("Thu, Oct 22")').first().click(); await p.waitForTimeout(300)
log('B: right after opening', await p.evaluate(() => ({ loading: document.querySelector('.loading')?.textContent ?? null, editor: !!document.querySelector('.continuous-editor') })))
await p.waitForTimeout(4500); mP.v = 'ok'
log('B: after save landed', await p.evaluate(m => ({ copies: [...document.querySelectorAll('.continuous-editor')].map(e => e.textContent.split(m).length - 1)[0], status: document.querySelector('.editor-save-line')?.textContent }), markP))
log('B: line before typing', await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-inline-content')].map(e => e.textContent).filter(t => t.includes('PAC'))));
await typeIn(p, 'more'); await p.waitForTimeout(300); log('B: line after typing', await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-inline-content')].map(e => e.textContent).filter(t => t.includes('PAC')))); await p.waitForTimeout(2500); log('B: typing after', await p.evaluate(() => document.querySelector('.editor-save-line')?.textContent))
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); log('B: line after reload', await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-inline-content')].map(e => e.textContent).filter(t => t.includes('PAC')))); log('B: server copies after reload', await p.evaluate(m => document.querySelector('.continuous-editor')?.textContent.split(m).length - 1, markP))
console.log('errors:', errors.length ? errors.join(' | ') : 'none'); await b.close()
