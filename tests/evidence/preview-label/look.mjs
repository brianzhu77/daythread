import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const out = '/tmp/jazz-prev-run'
for (const [port, preview] of [[3658, false], [3661, true]]) {
  for (const [br, width, height, scheme] of [[chromium, 1280, 900, 'light'], [chromium, 1280, 900, 'dark'], [webkit, 390, 844, 'light'], [webkit, 390, 844, 'dark']]) {
    const b = await br.launch(); const p = await b.newPage({ viewport: { width, height }, colorScheme: scheme, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
    const errs = []; p.on('pageerror', e => errs.push(e.message))
    await p.goto(`http://127.0.0.1:${port}/`); await p.waitForSelector('.day-head', { timeout: 15000 }); await p.waitForTimeout(800)
    const tag = `${preview ? 'preview' : 'prod'}-${width}-${scheme}`
    const g = await p.evaluate(() => ({ title: document.title, cap: !!document.querySelector('.brand-preview'), capVisible: (() => { const e = document.querySelector('.brand-preview'); return !!e && e.getBoundingClientRect().width > 0 })(), note: (() => { const e = document.querySelector('.preview-note'); return e && e.getBoundingClientRect().height > 0 ? e.textContent : null })() }))
    if (!preview) ok(g.title === 'Daythread' && !g.cap && !g.note, `${tag}: production shows no preview marks (title "${g.title}")`)
    else if (width === 1280) ok(g.title === 'Daythread Preview' && g.capVisible && !g.note, `${tag}: caption by the wordmark, no phone line`)
    else ok(g.title === 'Daythread Preview' && g.note === 'Preview · notes written here stay here', `${tag}: phone line on top`)
    ok(errs.length === 0, `${tag}: no page errors ${errs.join(' | ')}`)
    await p.screenshot({ path: `${out}/${tag}.png`, clip: { x: 0, y: 0, width, height: width === 390 ? 260 : 200 } })
    await b.close()
  }
}
process.exitCode = fail ? 1 : 0
