import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = 'http://127.0.0.1:3654', out = '/tmp/jazz-b70-run/shots'
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const c = await chromium.launch()
const p = await c.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto(base + '/pages?view=templates'); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForTimeout(500)
ok(await p.getByRole('button', { name: 'Edit' }).count() === 1, 'fresh: built-in line with Edit')
await p.getByRole('button', { name: 'Edit' }).click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(800)
await p.locator('.template-target').selectOption(''); await p.waitForTimeout(900)
await p.getByRole('link', { name: 'Templates' }).click(); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForTimeout(600)
ok(/view=templates/.test(p.url()), 'crumb goes back to the Templates list')
ok(await p.getByRole('button', { name: 'Edit' }).count() === 0, 'after None: no Edit line, so no second Day')
ok(await p.locator('.card-row', { hasText: 'Day' }).count() === 1, 'one Day row')
await p.screenshot({ path: `${out}/fix-list-after-none.png` })
await c.close()
const w = await webkit.launch()
for (const scheme of ['light', 'dark']) {
  const q = await w.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true })
  await q.goto(base + '/pages?view=templates'); await q.locator('.card-row', { hasText: 'Day' }).first().tap(); await q.locator('.template-target').waitFor(); await q.waitForTimeout(900)
  const g = await q.evaluate(() => { const a = document.querySelector('.template-screen .crumb').getBoundingClientRect(), t = document.querySelector('[aria-label="Page title"]').getBoundingClientRect(); return { crumbLeft: a.left, titleLeft: t.left, crumbH: a.height } })
  ok(Math.abs(g.crumbLeft - g.titleLeft) <= 1, `390 ${scheme}: crumb on the title's left edge (${g.crumbLeft} vs ${g.titleLeft})`)
  await q.screenshot({ path: `${out}/fix-390-${scheme}-template.png` })
  await q.getByRole('link', { name: 'Templates' }).tap(); await q.getByRole('heading', { name: 'Templates' }).waitFor({ timeout: 5000 })
  ok(true, `390 ${scheme}: tapping the crumb returns to Templates`)
  await q.close()
}
await w.close(); process.exitCode = fail ? 1 : 0
