import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = 'http://127.0.0.1:3657', out = '/tmp/jazz-p2-run/shots'
const LONG = 'Pages in Nested notes › Korean soup notes with a very long title that keeps going past the edge 中文标题需要换行'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
let made = false
for (const [br, width, height, scheme] of [[chromium, 1280, 900, 'light'], [webkit, 390, 844, 'light'], [webkit, 390, 844, 'dark']]) {
  const b = await br.launch(); const p = await b.newPage({ viewport: { width, height }, colorScheme: scheme, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
  await p.goto(base + '/pages?view=templates'); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForTimeout(500)
  if (!made) { await p.getByRole('button', { name: 'New template' }).click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(800); await p.keyboard.type('Long'); await p.waitForTimeout(1000); made = true }
  else { await p.locator('.card-row', { hasText: 'Long' }).first().click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(900) }
  // real nested option first, then a forced long option (DOM only) to test the CSS
  await p.locator('.template-target').selectOption({ label: 'Pages in Korean soup › Sub of soup' }).catch(() => {})
  await p.waitForTimeout(700)
  await p.evaluate(LONG => { const s = document.querySelector('.template-target'); const o = document.createElement('option'); o.value = 'x-long'; o.textContent = LONG; s.append(o); s.value = 'x-long' }, LONG)
  await p.waitForTimeout(300)
  const g = await p.evaluate(() => { const s = document.querySelector('.template-target').getBoundingClientRect(), col = document.querySelector('[aria-label="Page title"]').getBoundingClientRect(), doc = document.documentElement.scrollWidth; return { selL: s.left, selR: s.right, colL: col.left, colR: col.right, doc, vw: innerWidth } })
  const tag = `${width}-${scheme}`
  const lab = await p.evaluate(() => { const l = document.querySelector('.template-note label'); const r = document.createRange(); r.setStart(l.firstChild, 0); r.setEnd(l.firstChild, l.firstChild.length); return r.getClientRects().length })
  ok(lab === 1, `${width}-${scheme}: "Default for:" on one line (${lab})`)
  ok(g.doc <= g.vw, `${tag}: page doesn't widen (scrollWidth ${g.doc} ≤ ${g.vw})`)
  ok(g.selR <= g.colR + 1, `${tag}: select ends inside the text column (${Math.round(g.selR)} ≤ ${Math.round(g.colR)})`)
  await p.locator('.page-head').screenshot({ path: `${out}/long-${tag}.png` })
  await b.close()
}
process.exitCode = fail ? 1 : 0
