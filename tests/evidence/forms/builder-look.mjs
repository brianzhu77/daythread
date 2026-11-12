// The form's boxes and the builder's Files preview (DESIGN.md's checkbox; Jazz on #176): every box on the answering page
// and in the builder is the 20 px signature checkbox (5 px corners, a radio round; the 1.5 px edge snaps to device pixels), and a Files question shows "+ Add a file" in the builder's preview.
// Usage: node tests/evidence/forms/builder-look.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/forms/builder-look.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const boxes = page => page.locator('.form-choice > input, .form-check > input, .form-required-switch > input, .form-ask-values input[type=checkbox]').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return [Math.round(r.width), Math.round(r.height), e.type === 'radio' ? s.borderRadius === '50%' : s.borderRadius === '5px', s.borderTopColor] }))
for (const width of [1280, 390]) {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/forms/seed.ts ${S} files`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block' }), page = await context.newPage()
  const tap = l => (width === 390 ? l.tap() : l.click())
  await page.goto(`${base}/form?db=runs&view=f`); await wait(2000)
  const answering = await boxes(page)
  await page.goto(`${base}/pages?page=runs`); await wait(2200)
  await tap(page.getByRole('button', { name: /^Table/ }).first()); await wait(300); await tap(page.locator('.database-menu').getByText('Log a run', { exact: true }).first()); await wait(800)
  const preview = await page.locator('[data-question="pics"] .form-add, .form-question-preview .form-add').first().evaluate(e => ({ text: e.textContent, opacity: getComputedStyle(e).opacity })).catch(() => null)
  await tap(page.getByRole('button', { name: 'Edit Note' })); await wait(300)
  await page.getByLabel('Ask only if').selectOption('feel'); await wait(600)
  const building = await boxes(page)
  const all = [...answering, ...building], signature = all.length > 0 && all.every(([w, h, shape]) => w === 20 && h === 20 && shape)
  const ok = signature && preview?.text === '+ Add a file' && preview.opacity === '1'
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', `${width}: every box is the 20 px signature checkbox, and the builder shows "+ Add a file"`, JSON.stringify({ boxes: all.length, odd: all.filter(([w, h, shape]) => !(w === 20 && h === 20 && shape)).slice(0, 3), preview }))
  await context.close()
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
