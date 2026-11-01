// The app on a build that sends only what changed: every command reply carries `changes`, none falls back to a load,
// and what's on screen after typing and ticking is what a reload shows. Usage: node browser.mjs <base> (fresh dev store
// with VITE_DEV_MENU=1; seeds the sample data).
import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [base] = process.argv.slice(2)
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await chromium.launch(), p = await b.newPage({ serviceWorkers: 'block' })
const replies = [], loads = []
p.on('response', async r => {
  if (!r.url().includes('/_serverFn/')) return
  if (r.request().method() === 'GET') { loads.push(r.url()); return }
  const body = await r.text().catch(() => ''); replies.push({ bytes: body.length, changes: body.includes('"changes"'), whole: body.includes('"workspace"') })
})
await p.goto(`${base}/`)
await p.locator('details.banner summary').click(); await p.getByRole('button', { name: 'Add sample data' }).click()
await p.getByText('Sample data added').waitFor()
await p.goto(`${base}/`); await p.locator('.bn-editor').first().waitFor()
await p.waitForTimeout(1000)
replies.length = 0; loads.length = 0
// Type a line at the end of today's page, then tick the first to-do.
const editor = p.locator('.bn-editor').first()
await editor.locator('[data-content-type]').last().click()
await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.press('Enter'); await p.keyboard.type('Typed after the change')
await p.waitForTimeout(2500)
const box = p.locator('.bn-editor input[type=checkbox]').first()
const wasChecked = await box.isChecked(); await box.click(); await p.waitForTimeout(2500)
const shown = await editor.innerText(), checked = await box.isChecked()
ok(replies.length >= 2, `commands sent: ${replies.length}`)
ok(replies.every(r => r.changes && !r.whole), `every reply carries changes, none the whole workspace (${replies.map(r => r.bytes).join(', ')} bytes)`)
ok(loads.length === 0, `no reply fell back to a load (${loads.length} loads)`)
ok(checked !== wasChecked, 'the tick shows')
await p.reload(); await p.locator('.bn-editor').first().waitFor(); await p.waitForTimeout(1000)
const after = await p.locator('.bn-editor').first().innerText()
ok(after === shown, 'after a reload the page reads exactly as it did')
ok(after.includes('Typed after the change'), 'the typed line is stored')
ok(await p.locator('.bn-editor input[type=checkbox]').first().isChecked() === checked, 'the tick is stored')
await b.close()
console.log(fail ? `${fail} failed` : 'all pass'); process.exit(fail ? 1 : 0)
