import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await chromium.launch()
for (const [stored, expect] of [['1', 1], ['0', 0]]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto('http://127.0.0.1:3661/'); await p.waitForSelector('.day-head'); await p.waitForTimeout(800)
  let aborted = 0
  await p.route('**/_serverFn/**', r => { aborted++; return r.abort() })
  await p.evaluate(s => { localStorage.setItem('daythread.preview', s) }, stored)
  await p.evaluate(async () => { await window.__TSR_ROUTER__.invalidate() }); await p.waitForTimeout(1500)
  const caps = await p.locator('.brand-preview').count()
  ok(aborted > 0 && caps === expect, `all server calls fail (${aborted} aborted), stored "${stored}": caption ${caps ? 'shown' : 'gone'}`)
  await p.close()
}
await b.close(); process.exitCode = fail ? 1 : 0
