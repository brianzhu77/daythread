// Search (docs/design/search-states.md) in the browser, over the converted v1 fixture. Run:
//   cp tests/fixtures/v1/workspace.sqlite /tmp/smoke.sqlite
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/smoke.sqlite TZ=America/Vancouver npx vite preview --port 3043 &
//   TZ=America/Vancouver node tests/evidence/search/ui-check.mjs /tmp/search-out      (screenshots land there)
// Needs a production build (npm run build) and Playwright's Chromium; set CHROMIUM to its path if not /opt/pw-browsers/chromium.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const base = 'http://127.0.0.1:3043'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const out = process.argv[2]
const results = []
async function run(name, width, fn, colorScheme = 'light') {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  try { await fn(page); results.push({ name, ok: true, errors }) }
  catch (e) { results.push({ name, ok: false, error: e.message, errors }); await page.screenshot({ path: `${out}/fail-${name}.png` }).catch(() => {}) }
  finally { await page.close() }
}
const dialog = page => page.getByRole('dialog', { name: 'Search' })
const field = page => dialog(page).getByRole('searchbox')
/** The dialog's entry fade is over (a screenshot taken during it shows the page through the dialog). */
const settled = page => page.waitForFunction(() => { const c = document.querySelector('[data-slot=modal-container]'); return c && getComputedStyle(c).opacity === '1' }, null, { timeout: 5000 })

await run('laptop-shortcut-and-results', 1280, async page => {
  await page.goto(base + '/pages')
  await page.locator('.card-row').first().waitFor({ timeout: 30000 })
  // The sidebar row shows the shortcut; ⌘K opens the dialog with the field focused.
  assert.equal(await page.locator('.search-side-row .side-kbd').innerText(), process.platform === 'darwin' ? '⌘K' : 'Ctrl K')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await dialog(page).waitFor({ timeout: 5000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'search')
  const empty = await dialog(page).innerText()
  assert(empty.includes('Today'), 'the empty field lists Today')
  assert(empty.includes('Type to search everything'), 'the hint')
  await settled(page)
  await page.screenshot({ path: `${out}/laptop-empty.png` })
  await field(page).fill('soup')
  await dialog(page).locator('.search-group', { hasText: 'Pages' }).waitFor({ timeout: 5000 })
  const text = await dialog(page).innerText()
  assert(text.includes('Korean soup'), 'the page title matches')
  assert(text.includes('Sub of soup'), 'the nested page too, with its path')
  assert(text.includes('Pages › Korean soup'), 'the path under a nested page')
  assert.equal(await dialog(page).locator('mark').first().innerText(), 'soup', 'the typed word is bold')
  assert.equal(await dialog(page).locator('.search-row.active').count(), 1, 'the first row is active')
  await field(page).fill('roof')
  await dialog(page).locator('.search-group', { hasText: 'Lines' }).waitFor({ timeout: 5000 })
  const lines = await dialog(page).innerText()
  assert(lines.includes('Call about the roof'), 'a to-do row by its words')
  assert(lines.includes('Wed, Oct 21'), 'with the day it was written on')
  await settled(page)
  await page.screenshot({ path: `${out}/laptop-results.png` })
  // ↓ moves, Enter opens the active row and the dialog closes.
  await page.keyboard.press('ArrowDown')
  const secondHref = await dialog(page).locator('.search-row.active .search-row-title, .search-row.active .search-row-line').innerText()
  await page.keyboard.press('Enter')
  await dialog(page).waitFor({ state: 'hidden', timeout: 5000 })
  assert(secondHref.length > 0)
  assert(/\/pages\?page=|\/day\//.test(page.url()), `opened a page or a day: ${page.url()}`)
  // Esc closes.
  await page.locator('.search-side-row').click()
  await dialog(page).waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await dialog(page).waitFor({ state: 'hidden', timeout: 5000 })
})

await run('laptop-no-results-and-tags', 1280, async page => {
  await page.goto(base + '/')
  await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.search-side-row').click()
  await field(page).fill('zzqx no such words')
  await dialog(page).getByText('Nothing matches').waitFor({ timeout: 5000 })
  await settled(page)
  await page.screenshot({ path: `${out}/laptop-nothing.png` })
  await field(page).fill('#')
  await page.waitForTimeout(200)
  const tags = await dialog(page).locator('.search-group', { hasText: 'Tags' }).count()
  results.push({ name: 'tags-group-shown-for-#', ok: true, note: tags ? 'the fixture has tags, the Tags group showed' : 'no tags in the fixture; no Tags group' })
})

await run('laptop-dark', 1280, async page => {
  await page.goto(base + '/pages')
  await page.locator('.card-row').first().waitFor({ timeout: 30000 })
  await page.locator('.search-side-row').click()
  await field(page).fill('roof')
  await dialog(page).locator('.search-group', { hasText: 'Lines' }).waitFor({ timeout: 5000 })
  await settled(page)
  await page.screenshot({ path: `${out}/laptop-results-dark.png` })
}, 'dark')

await run('phone-button-sheet-and-line-jump', 390, async page => {
  await page.goto(base + '/pages')
  await page.locator('.card-row').first().waitFor({ timeout: 30000 })
  const button = page.getByRole('button', { name: 'Search' })
  const box = await button.boundingBox()
  assert(box && box.width >= 44 && box.height >= 44, 'a 44px tap target')
  const capsule = await page.locator('.tab-capsule').boundingBox()
  assert(capsule && capsule.x + capsule.width <= box.x, 'the button sits to the right of the capsule')
  assert(box.x + box.width <= 390 - 16, 'inside the 16px edge')
  await page.screenshot({ path: `${out}/phone-pages.png` })
  await button.click()
  await dialog(page).waitFor({ timeout: 5000 })
  assert(await dialog(page).locator('.sheet-handle').count() === 1, 'a sheet on the phone')
  await field(page).fill('roof')
  await dialog(page).locator('.search-group', { hasText: 'Lines' }).waitFor({ timeout: 5000 })
  // No horizontal overflow at 390.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  await settled(page)
  await page.screenshot({ path: `${out}/phone-results.png` })
  // A line opens where it was written and the block jump tints it.
  const line = dialog(page).locator('.search-row', { has: page.locator('.search-row-line') }).first()
  const where = await line.locator('small').innerText()
  await line.click()
  await dialog(page).waitFor({ state: 'hidden', timeout: 5000 })
  await page.locator('.block-flash').first().waitFor({ timeout: 15000 })
  results.push({ name: 'phone-line-opened', ok: true, where, url: page.url() })
  // Cancel closes the sheet.
  await page.getByRole('button', { name: 'Search' }).click()
  await dialog(page).waitFor({ timeout: 5000 })
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await dialog(page).waitFor({ state: 'hidden', timeout: 5000 })
})

await run('phone-dark-empty', 390, async page => {
  await page.goto(base + '/tasks')
  await page.locator('.task-list, .empty-box').first().waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Search' }).click()
  await dialog(page).waitFor({ timeout: 5000 })
  await settled(page)
  await page.screenshot({ path: `${out}/phone-empty-dark.png` })
}, 'dark')

await browser.close()
for (const r of results) console.log(JSON.stringify(r))
if (results.some(r => !r.ok)) process.exit(1)
