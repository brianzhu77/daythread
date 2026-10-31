import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
const b = await chromium.launch()
let fail = 0
const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
  await p.goto(base + '/day/2026-10-21'); await p.waitForSelector('.side-label-row'); await p.waitForTimeout(800)
  const g = await p.evaluate(() => {
    const r = e => e?.getBoundingClientRect()
    const labels = [...document.querySelectorAll('.side-label')]
    const days = labels.find(l => l.textContent === 'Days'), pages = labels.find(l => l.textContent === 'Pages')
    const add = document.querySelector('.side-label-add')
    const anyRow = document.querySelector('.tree-row')
    const rowsUnderPages = document.querySelectorAll('[aria-label="Pages"] .tree-row').length
    const hint = document.querySelector('[aria-label="Pages in your days"]')
    const empty = [...document.querySelectorAll('.side-hint')].map(e => e.textContent)
    const oldRow = [...document.querySelectorAll('button')].some(x => x.textContent.includes('New page') && !x.classList.contains('side-label-add'))
    const pt = getComputedStyle(pages).paddingTop, dt = getComputedStyle(days).paddingTop
    const pr = r(pages), dr = r(days), ar = r(add), rowR = r(anyRow)
    // vertical centre of the label's text box (content box)
    const pcy = pr.top + parseFloat(getComputedStyle(pages).paddingTop) + (pr.height - parseFloat(getComputedStyle(pages).paddingTop) - parseFloat(getComputedStyle(pages).paddingBottom)) / 2
    return { pagesLabelH: pr.height, daysLabelH: dr.height, pt, dt, addRight: ar.right, rowRight: rowR.right - 4, addCy: ar.top + ar.height / 2, labelCy: pcy, addColor: getComputedStyle(add).color, labelColor: getComputedStyle(pages).color, aria: add.getAttribute('aria-label'), rowsUnderPages, hint: !!hint, empty, oldRow, labelLeft: pr.left + parseFloat(getComputedStyle(pages).paddingLeft) }
  })
  console.log(scheme, JSON.stringify(g))
  ok(Math.abs(g.addRight - g.rowRight) <= 1, `${scheme}: + right edge ${g.addRight} = rows' action edge ${g.rowRight}`)
  ok(Math.abs(g.addCy - g.labelCy) <= 1, `${scheme}: + centred on the label text (${g.addCy.toFixed(1)} vs ${g.labelCy.toFixed(1)})`)
  ok(g.addColor === g.labelColor, `${scheme}: + uses the label's ink-2`)
  ok(!g.hint && !g.oldRow, `${scheme}: no day-pages hint, no old ＋ New page row`)
  ok(g.aria === 'New page', `${scheme}: aria-label`)
  await p.locator('.side-group').screenshot({ path: `/tmp/jazz-pplus-run/shots/sidebar-${scheme}.png` })
  await p.locator('.side-label-add').hover(); await p.waitForTimeout(150)
  await p.locator('.side-label-row').screenshot({ path: `/tmp/jazz-pplus-run/shots/plus-hover-${scheme}.png` })
  await p.close()
}
// keyboard create, light
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto(base + '/day/2026-10-21'); await p.waitForSelector('.side-label-add'); await p.waitForTimeout(600)
const before = await p.locator('[aria-label="Pages"] .tree-row').count()
await p.locator('.side-label-add').focus(); await p.keyboard.press('Enter')
await p.waitForURL(/\/pages\?page=.*focus=title/, { timeout: 8000, waitUntil: 'commit' }); await p.waitForSelector('.side-label-row'); await p.waitForTimeout(1000)
const after = await p.locator('[aria-label="Pages"] .tree-row').count()
ok(after === before + 1, `Enter on + makes a top-level page (${before} -> ${after}) and opens it: ${new URL(p.url()).search}`)
const cur = await p.locator('[aria-label="Pages"] .tree-row[aria-current="page"]').count()
ok(cur === 1, 'the new page is the current row under Pages')
await p.locator('.side-group').screenshot({ path: '/tmp/jazz-pplus-run/shots/after-create.png' })
await b.close(); process.exitCode = fail ? 1 : 0
