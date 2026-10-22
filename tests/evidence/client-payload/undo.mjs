// Undo in the browser with the trimmed payload (Lead): tick a task on the Tasks screen, press Undo in the notice, and
// the task is open again in the database.
//   node undo.mjs <base url> <db copy> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const status = title => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT status FROM tasks WHERE snapshot='current' AND title=?").get(title)?.status } finally { d.close() } }
const browser = await chromium.launch(), errors = []
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', e => errors.push(e.message))
await page.goto(`${base}/tasks?view=all`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
const box = page.locator('input.check:not(:checked)').first()
const label = await box.getAttribute('aria-label'), title = label?.replace(/^Mark (.*) done$/, '$1')
log(Boolean(title) && status(title) === 'open', 'an open task to tick', title ?? 'none')
await box.click(); await page.waitForTimeout(1200)
log(status(title) === 'done', 'ticked: done in the database')
const undo = page.getByRole('button', { name: 'Undo' }).first()
log(await undo.isVisible(), 'the notice offers Undo')
await undo.click(); await page.waitForTimeout(1500)
log(status(title) === 'open', 'Undo: open again in the database')
log(errors.length === 0, 'no page errors', errors.join(' | '))
await browser.close()
console.log(failures ? `${failures} failed` : 'all passed'); process.exit(failures ? 1 : 0)
