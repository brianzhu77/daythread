// B40 check: kept draft visible from any screen and saved in the background. Usage: node b40.mjs <engine> <width> <port>
const pw = await import('playwright')
const [engine, width, port] = [process.argv[2], Number(process.argv[3]), process.argv[4]], phone = width < 900
const b = await pw[engine].launch(); const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, deviceScaleFactor: 2 })
const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message))
const base = `http://127.0.0.1:${port}`, tag = `${engine}${width}`, mark = `kept${width}${engine[0]}${Date.now() % 1000}`
const log = (k, v) => console.log(`${tag} | ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
const state = () => p.evaluate(() => {
  const vis = e => e && getComputedStyle(e).display !== 'none' ? (r => [r.left, r.top, r.right, r.bottom].map(Math.round))(e.getBoundingClientRect()) : 'hidden'
  const l = document.querySelector('.editor-unsaved-line.is-elsewhere')
  return { line: l ? { text: l.textContent, box: vis(l) } : null, dots: [...document.querySelectorAll('.tab.has-unsaved')].map(t => t.getAttribute('aria-label')), header: [...document.querySelectorAll('.save-indicator, .banner, [role=alert]')].map(e => e.textContent.trim().slice(0, 60)).filter(Boolean), path: location.pathname }
})
const go = async (label, to) => { if (phone) await p.locator(`.tab-bar .tab[aria-label^="${label}"]`).tap(); else await p.locator(`.sidebar .side-row:has-text("${label}")`).first().click(); await p.waitForURL(u => u.pathname.startsWith(to), { waitUntil: 'commit' }); await p.waitForTimeout(1200) }
const typeInNotes = async text => { const l = p.getByText('PAC Lunch').first(); phone ? await l.tap() : await l.click(); await p.keyboard.press('End'); await p.keyboard.type(` ${text}`) }
let block = true; await p.route('**/*', r => (block && r.request().method() === 'POST' && (r.request().postData() ?? '').includes('save-editor')) ? r.abort('failed') : r.continue())
await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
// 1. saves failing: type on Oct 22, leave for Pages
await typeInNotes(mark); await p.waitForTimeout(2000); await go('Pages', '/pages'); await p.waitForTimeout(3500)
log('failing, on Pages', await state()); await p.screenshot({ path: `/tmp/b40-${tag}-pages.png` })
await go('Tasks', '/tasks'); await p.waitForTimeout(1000); log('failing, on Tasks', await state())
// 2. offline on Tasks
await ctx.setOffline(true); await p.waitForTimeout(2500); log('offline, on Tasks', await state()); await p.screenshot({ path: `/tmp/b40-${tag}-offline.png` })
// 3. back: saves in the background without opening the page
block = false; await ctx.setOffline(false); await p.waitForTimeout(6000); log('back online', await state())
log('slots left', await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:')).map(k => [k.slice(17, 40), JSON.parse(localStorage.getItem(k)).document?.length ?? 0])))
await go('Today', '/'); await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
log('Oct 22: text there', await p.getByText(mark).count()); log('Oct 22: notices', await p.evaluate(() => [...document.querySelectorAll('[data-slot="toast"]')].map(t => t.innerText))); log('Oct 22: status', await p.evaluate(() => document.querySelector('.editor-save-line')?.textContent))
console.log('errors:', errors.length ? errors.join(' | ') : 'none'); await b.close()
