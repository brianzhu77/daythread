import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = 'http://127.0.0.1:3655', out = '/tmp/jazz-p2-run/shots'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const c = await chromium.launch()
const p = await c.newPage({ viewport: { width: 1280, height: 900 } })
// Fresh: + first (blank), then check if the built-in line remains
await p.goto(base + '/pages?view=templates'); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForTimeout(500)
await p.screenshot({ path: `${out}/1280-list-fresh.png` })
await p.getByRole('button', { name: 'New template' }).click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(900)
ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Page title'), '+ opens a blank template with the caret in the title')
await p.keyboard.type('Recipe'); await p.waitForTimeout(1200)
const opts = await p.locator('.template-target option').allInnerTexts(); console.log('options', JSON.stringify(opts))
const groups = await p.locator('.template-target optgroup').evaluateAll(g => g.map(x => x.label)); console.log('groups', JSON.stringify(groups))
const korean = opts.find(o => o.startsWith('Korean soup'))
if (korean) await p.locator('.template-target').selectOption({ label: korean }); await p.waitForTimeout(900)
await p.screenshot({ path: `${out}/1280-recipe.png` })
await p.locator('.page-more').click(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/1280-menu.png` }); await p.keyboard.press('Escape')
await p.goto(base + '/pages?view=templates'); await p.waitForTimeout(800)
const listText = await p.locator('.list-screen').innerText(); console.log('list', JSON.stringify(listText.slice(0, 300)))
ok(!listText.includes('Day pages start with'), '(observation) after + first, the built-in line is hidden: ' + listText.includes('Day pages start with'))
await p.screenshot({ path: `${out}/1280-list-after-plus.png` })
await c.close()
const w = await webkit.launch()
for (const scheme of ['light', 'dark']) {
  const q = await w.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true })
  await q.goto(base + '/pages?view=templates'); await q.waitForTimeout(900); await q.screenshot({ path: `${out}/390-${scheme}-list.png` })
  await q.locator('.card-row', { hasText: 'Recipe' }).tap(); await q.locator('.template-target').waitFor(); await q.waitForTimeout(900)
  const g = await q.evaluate(() => { const sel = document.querySelector('.template-target').getBoundingClientRect(), vw = innerWidth, more = document.querySelector('.page-more').getBoundingClientRect(); return { selRight: sel.right, vw, moreRight: more.right, moreH: more.height } })
  ok(g.selRight <= g.vw - 16, `390 ${scheme}: Default for select fits (${g.selRight} of ${g.vw})`)
  await q.screenshot({ path: `${out}/390-${scheme}-recipe.png` })
  await q.locator('.page-more').tap(); await q.waitForTimeout(500); await q.screenshot({ path: `${out}/390-${scheme}-menu.png` })
  await q.close()
}
await w.close(); process.exitCode = fail ? 1 : 0
