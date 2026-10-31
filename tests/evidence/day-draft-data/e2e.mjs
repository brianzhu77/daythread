import { webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await webkit.launch()
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Vancouver' })
const p = await ctx.newPage()
p.on('pageerror', e => { if (!/access control/.test(e.message)) console.log('pageerror', e.message.slice(0, 160)) })
const posts = []; p.on('request', r => { if (r.method() === 'POST' && r.url().includes('_serverFn')) posts.push(Date.now()) })
await p.goto(`${base}/day/2026-10-31`)
await p.waitForSelector('.continuous-editor')
const t0 = Date.now()
const line = p.locator('.draft-line')
await line.waitFor({ timeout: 60000 }).catch(() => {})
console.log('line:', JSON.stringify(await line.first().textContent().catch(() => null)))
await p.waitForSelector('.draft-band', { timeout: 60000 }).catch(() => {})
console.log('bands after', ((Date.now() - t0) / 1000).toFixed(1), 's')
const bands = await p.locator('.draft-band').evaluateAll(els => els.map(e => e.className + ' | ' + (e.textContent || '').slice(0, 50)))
console.log(bands.join('\n'))
ok(bands.length > 0, 'bands shown on today\'s page')
const order = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-content, .draft-band')].map(e => (e.classList.contains('draft-band') ? 'BAND ' : e.getAttribute('data-content-type') + ' ') + (e.textContent || '').trim().slice(0, 40)))
console.log('order:\n' + (await order()).join('\n'))
await p.screenshot({ path: '/tmp/rb-dd/1-bands.png', fullPage: true })
const applyBtn = p.locator('.draft-band button[aria-label^="Apply"]').first()
if (await applyBtn.count()) {
  const label = await applyBtn.getAttribute('aria-label')
  await applyBtn.tap(); await p.waitForTimeout(2500)
  console.log('applied', label)
  console.log('after apply:\n' + (await order()).slice(0, 14).join('\n'))
  const toast = await p.locator('[role="status"], .toast, [data-sonner-toast]').allTextContents().catch(() => [])
  console.log('notices:', JSON.stringify(toast).slice(0, 200))
}
await p.screenshot({ path: '/tmp/rb-dd/2-applied.png', fullPage: true })
await b.close()
process.exitCode = fail ? 1 : 0
