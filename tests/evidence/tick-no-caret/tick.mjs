// A tick never moves the caret into the ticked line, never raises the keyboard, never scrolls (Jazz 5612c295,
// Bumblebee 8f23bd5e, Jazz d1f45fdd). Usage: node tick.mjs <base> [seed]. Seed once on a fresh dev store.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [base, seed] = process.argv.slice(2)
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }

const state = p => p.evaluate(() => {
  const s = window.getSelection(), a = document.activeElement
  const line = s?.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('[data-id]')
  return { editor: Boolean(a?.closest('.bn-editor')), active: a?.tagName ?? null, line: s?.rangeCount && a?.closest('.bn-editor') ? line?.dataset.id ?? null : null, offset: s?.anchorOffset ?? null, scroll: Math.round(window.scrollY) }
})

const passes = [['chromium', chromium, false], ['webkit', webkit, false], ['webkit-touch', webkit, true]]
for (const [name, br, touch] of passes) {
  const b = await br.launch()
  const c = await b.newContext({ serviceWorkers: 'block', viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 }, ...(touch ? { isMobile: true, hasTouch: true } : {}) })
  const p = await c.newPage(); p.on('pageerror', e => console.log('pageerror', e.message))
  await p.goto(`${base}/`)
  if (seed && name === 'chromium') {
    await p.locator('details.banner summary').click(); await p.getByRole('button', { name: 'Add sample data' }).click()
    await p.getByText('Sample data added').waitFor(); await p.goto(`${base}/`)
  }
  await p.waitForSelector('.editor-task[data-status=open] input'); await p.waitForLoadState('networkidle')
  const rows = await p.locator('.editor-task[data-status=open]').evaluateAll(els => els.map(el => el.closest('[data-id]').dataset.id))
  const box = id => p.locator(`[data-id="${id}"] .editor-task input`).first()
  const press = async loc => (touch ? loc.tap() : loc.click())

  // 1. Nothing focused: a tick puts no caret anywhere and doesn't scroll.
  await p.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges() })
  let before = await state(p)
  await press(box(rows[0])); await p.waitForTimeout(400)
  let after = await state(p)
  ok(await box(rows[0]).isChecked(), `${name}: the tick ticks`)
  ok(!after.editor && after.line === null, `${name}: nothing focused -> no caret after a tick (${JSON.stringify(after)})`)
  ok(after.scroll === before.scroll, `${name}: no scroll (${before.scroll} -> ${after.scroll})`)
  await press(box(rows[0])); await p.waitForTimeout(1500)

  // 2. Caret resting in another line: a tick leaves it there.
  const other = p.locator(`[data-id="${rows[1]}"] .editor-task-title`).first()
  await press(other); await p.waitForTimeout(300)
  before = await state(p)
  await press(box(rows[0])); await p.waitForTimeout(400)
  after = await state(p)
  ok(before.line === rows[1], `${name}: text tap puts the caret in that line (${before.line})`)
  ok(after.editor && after.line === rows[1] && after.offset === before.offset, `${name}: caret stays in the line it was in (${JSON.stringify(before)} -> ${JSON.stringify(after)})`)
  ok(after.scroll === before.scroll, `${name}: no scroll with the caret up (${before.scroll} -> ${after.scroll})`)
  await press(box(rows[0])); await p.waitForTimeout(1500)
  await b.close()
}
console.log(fail ? `${fail} FAIL` : 'ALL PASS'); process.exit(fail ? 1 : 0)
