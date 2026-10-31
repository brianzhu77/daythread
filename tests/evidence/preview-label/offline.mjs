import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage()
// 1. preview visit stores the answer
await p.goto('http://127.0.0.1:3661/'); await p.waitForSelector('.day-head'); await p.waitForTimeout(800)
ok(await p.evaluate(() => localStorage.getItem('daythread.preview')) === '1', 'preview visit keeps "1" in this browser')
// 2. same browser storage, the call fails, loader re-runs in the browser: marks stay
const router = await p.evaluate(() => typeof window.__TSR_ROUTER__)
console.log('router handle:', router)
await p.route('**/_serverFn/**', r => { const u = r.request().url(); return /getAppInfo|appinfo/i.test(decodeURIComponent(u)) ? r.abort() : r.continue() })
let reran = false
if (router === 'object') {
  await p.evaluate(async () => { await window.__TSR_ROUTER__.invalidate() }); await p.waitForTimeout(1200); reran = true
  ok(await p.locator('.brand-preview').count() === 1 && (await p.title()) === 'Daythread Preview', 'call fails after invalidate: caption and title stay (recalled)')
}
console.log('reran in browser:', reran)
// 3. production visit stores "0"
const q = await ctx.newPage(); await q.goto('http://127.0.0.1:3658/'); await q.waitForSelector('.day-head'); await q.waitForTimeout(800)
ok(await q.evaluate(() => localStorage.getItem('daythread.preview')) === '0' && await q.locator('.brand-preview').count() === 0, 'production visit keeps "0", no marks (separate origin)')
await b.close(); process.exitCode = fail ? 1 : 0
