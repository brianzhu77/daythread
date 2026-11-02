// A phone's table sheet leaves the focused field, and the database title and filter values save when the page is hidden
// (R1-7, R1-15). The keyboard itself needs a real iOS run; here, what's focused and what's saved. Fresh store from seed-table.ts.
// Usage: node tests/evidence/databases/phone-fields.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/phone-fields.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const list = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString()).pages.find(p => p.id === 'list')
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
let failed = 0
const check = (ok, what) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', what) }
const hide = () => page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
const open = async () => { await page.goto(`${base}/pages?page=books`); await page.locator('.database-title').waitFor() }
const saved = async read => { for (let i = 0; i < 40 && !read(); i++) await page.waitForTimeout(100); return read() }
const nothingFocused = () => page.evaluate(() => document.activeElement === document.body && !getSelection().rangeCount)

await open()
const tick = await page.evaluate(() => { const r = document.querySelector('.database-td .property-checkbox.is-checked svg').getBoundingClientRect(); return r.width })
check(tick > 0, `a ticked box in an inline table draws its tick (${tick}px)`)

for (const [name, button] of [['⋯', '.database-more-button'], ['Table', '[data-database-views]']]) {
  await open()
  const title = page.locator('.database-title')
  await title.click(); await title.pressSequentially(name === '⋯' ? ' A' : ' B')
  const typed = await title.inputValue()
  await page.click(button); await page.locator('.database-menu').waitFor()
  check(await nothingFocused(), `title then ${name}: the sheet leaves the field`)
  check(await saved(() => list().title === typed), `title then ${name}: saved`)
  await open()
  await page.getByText('Before the table').click()
  check(await page.evaluate(() => Boolean(document.activeElement.closest('[contenteditable=true]'))), `the caret is in the page's text`)
  await page.click(button); await page.locator('.database-menu').waitFor()
  check(await nothingFocused(), `page text then ${name}: the sheet leaves the editor`)
}

await open()
const title = page.locator('.database-title')
await title.click(); await title.pressSequentially(' C')
const typed = await title.inputValue()
await hide()
check(await saved(() => list().title === typed), 'title, page hidden: saved')

await open()
await page.click('.database-more-button')
await page.locator('.database-menu button', { hasText: /^Filter$/ }).click()
await page.locator('.database-menu button', { hasText: '+ Add filter' }).click()
const value = page.locator('.database-rule input[aria-label="Value"]')
await value.waitFor(); await value.click()
check(await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Value'), 'a value field inside the sheet keeps its focus')
await value.pressSequentially('hidden')
await hide()
check(await saved(() => list().database.views[0].filter[0]?.value === 'hidden'), 'filter value, page hidden: saved')

// Hide then blur before the first save's reply: one write. A second "Add an option" with the same name is refused, with a
// Retry that can only fail (Lead's newOptionHide). The delay is Chromium-only evidence: WebKit's requests skip page.route.
await open()
await page.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await page.waitForTimeout(400); await r.continue().catch(() => {}) })
await page.click('.database-more-button')
await page.locator('.database-menu').getByRole('menuitem', { name: 'Properties' }).click()
await page.locator('.database-property-name', { hasText: 'Genre' }).click()
const option = page.getByRole('textbox', { name: 'New option' })
await option.click(); await page.keyboard.type('Poetry')
const posts = []; page.on('request', q => { if (q.method() === 'POST' && q.url().includes('_serverFn') && (q.postData() ?? '').includes('Poetry')) posts.push(q) })
await hide()
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }) })
await option.blur(); await page.waitForTimeout(2500)
const names = list().database.properties.find(p => p.name === 'Genre').options.map(o => o.name)
check(names.filter(n => n === 'Poetry').length === 1, `a new option, hide then blur: stored once (${names})`)
check(posts.length === 1, `and the blur sends nothing more (${posts.length} save)`)
check(!/not saved|Retry/i.test(await page.locator('body').innerText()), 'and no failure notice')
await page.unroute('**/_serverFn/**')

check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
