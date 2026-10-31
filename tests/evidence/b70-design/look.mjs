import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = 'http://127.0.0.1:3654', out = '/tmp/jazz-b70-run/shots'
const c = await chromium.launch(), w = await webkit.launch()
const info = []
// 1280 light: create via Edit; then all shots
for (const [br, width, height, scheme] of [[c, 1280, 900, 'light'], [c, 1280, 900, 'dark'], [w, 390, 844, 'light'], [w, 390, 844, 'dark']]) {
  const p = await br.newPage({ viewport: { width, height }, colorScheme: scheme, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const tag = `${width}-${scheme}`
  if (width === 1280) { await p.goto(base + '/day/2026-10-21'); await p.waitForSelector('.account-row-sidebar'); await p.waitForTimeout(600); await p.locator('.account-row-sidebar').screenshot({ path: `${out}/${tag}-account.png` }) }
  else { await p.goto(base + '/pages'); await p.waitForSelector('.account-row-phone'); await p.waitForTimeout(600); await p.locator('.account-row-phone').scrollIntoViewIfNeeded(); await p.locator('.account-row-phone').screenshot({ path: `${out}/${tag}-account.png` }) }
  await p.getByRole('button', { name: 'Templates' }).first().click(); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForTimeout(500)
  await p.screenshot({ path: `${out}/${tag}-list.png` })
  const edit = p.getByRole('button', { name: 'Edit' })
  if (await edit.count()) await edit.click(); else await p.locator('.card-row', { hasText: 'Day' }).first().click()
  await p.locator('.template-target').waitFor(); await p.waitForTimeout(1200)
  await p.screenshot({ path: `${out}/${tag}-template.png` })
  const g = await p.evaluate(() => {
    const r = s => document.querySelector(s)?.getBoundingClientRect()
    const title = r('[aria-label="Page title"]'), notes = [...document.querySelectorAll('.template-note')].map(e => e.getBoundingClientRect())
    const firstHeading = r('.bn-editor h2, .bn-editor [data-content-type="heading"]')
    const crumb = document.querySelector('.crumb, .page-header-row, nav[aria-label="Breadcrumb"]')
    const sel = document.querySelector('.template-target'), cs = getComputedStyle(sel)
    return { titleLeft: title?.left, noteLefts: notes.map(n => n.left), headingLeft: firstHeading?.left, crumb: crumb?.textContent ?? null, selFont: cs.fontSize, selColor: cs.color, selBg: cs.backgroundColor, selBorder: cs.borderStyle + ' ' + cs.borderColor, selH: sel.getBoundingClientRect().height }
  })
  info.push([tag, g])
  await p.close()
}
// toggle default to None then back, capture notice (1280 light)
const p = await c.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto(base + '/pages?view=templates'); await p.locator('.card-row', { hasText: 'Day' }).first().click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(800)
await p.locator('.template-target').selectOption(''); await p.waitForTimeout(900); await p.screenshot({ path: `${out}/1280-notice-none.png` })
const toast1 = await p.locator('[role="alert"], [data-sonner-toast], .toast, [role="status"]').allInnerTexts()
await p.goto(base + '/pages?view=templates'); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/1280-list-after-none.png` })
const listText = await p.locator('.list-screen').innerText()
info.push(['toast none', toast1, 'list after None', listText.slice(0, 300)])
await p.locator('.card-row', { hasText: 'Day' }).first().click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(600)
await p.locator('.template-target').selectOption('days'); await p.waitForTimeout(900); await p.screenshot({ path: `${out}/1280-notice-days.png` })
await c.close(); await w.close()
console.log(JSON.stringify(info, null, 1))
