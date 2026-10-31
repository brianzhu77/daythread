import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const c = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const p = await c.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
  await p.goto('http://127.0.0.1:3653/'); await p.waitForSelector('.side-label-row'); await p.waitForTimeout(800)
  const g = await p.evaluate(() => {
    const row = document.querySelector('.side-label-row').getBoundingClientRect()
    const days = [...document.querySelectorAll('.side-label')].find(l => l.textContent === 'Days').getBoundingClientRect()
    const hint = document.querySelector('.side-label-row + .side-hint')
    const lbl = document.querySelector('.side-label-row .side-label')
    return { rowH: row.height, daysH: days.height, hint: hint?.textContent, hintLeft: hint && hint.getBoundingClientRect().left + parseFloat(getComputedStyle(hint).paddingLeft), labelLeft: lbl.getBoundingClientRect().left + parseFloat(getComputedStyle(lbl).paddingLeft) }
  })
  ok(g.hint === 'No pages yet', `${scheme} blank store: "No pages yet" under Pages`)
  ok(Math.abs(g.hintLeft - g.labelLeft) <= 1, `${scheme}: empty line starts at the label's left edge (${g.hintLeft} vs ${g.labelLeft})`)
  ok(Math.abs(g.rowH - g.daysH) <= 1, `${scheme}: Pages row as tall as the Days label (${g.rowH} vs ${g.daysH})`)
  await p.locator('.side-group').screenshot({ path: `/tmp/jazz-pplus-run/shots/blank-${scheme}.png` })
  await p.close()
}
{ const p = await c.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto('http://127.0.0.1:3652/day/2026-10-21'); await p.waitForSelector('.side-label-add'); await p.waitForTimeout(600)
  await p.locator('.side-label-add').click(); await p.waitForURL(/focus=title/, { waitUntil: 'commit' }); await p.waitForTimeout(1200)
  ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Page title'), '1280: caret in the new page title')
  await p.keyboard.type('Reading list'); await p.waitForTimeout(1500)
  ok((await p.getByRole('tree', { name: 'Pages' }).innerText()).includes('Reading list'), '1280: typed title shows under Pages')
  await p.locator('.side-group').screenshot({ path: '/tmp/jazz-pplus-run/shots/after-title.png' })
  await p.close() }
await c.close()
const w = await webkit.launch()
for (const scheme of ['light', 'dark']) {
  const p = await w.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true })
  await p.goto('http://127.0.0.1:3652/pages'); await p.waitForSelector('.round-add'); await p.waitForTimeout(800)
  await p.locator('.round-add').tap(); await p.waitForURL(/focus=title/, { waitUntil: 'commit', timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1200)
  ok(/focus=title/.test(p.url()), `390 WebKit ${scheme}: Pages + opens a new untitled page with focus=title`)
  ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Page title'), `390 WebKit ${scheme}: caret in the title`)
  await p.screenshot({ path: `/tmp/jazz-pplus-run/shots/phone-new-${scheme}.png` })
  await p.close()
}
await w.close(); process.exitCode = fail ? 1 : 0
