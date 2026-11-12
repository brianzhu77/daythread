// A menu's focus ring follows the last input (Jazz 540b35ea): opened by a click, no ring on the item it focuses; after an arrow key, or opened from the keyboard, the ring shows.
// Usage: node tests/evidence/menu-ring/ring.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/menu-ring/ring.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/todo-dependency/seed.ts ${S} ${today}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage()
  let r
  try { await page.goto(`${base}/`); await wait(2400); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n')[0] } }
  if (!r.ok) failed++
  console.log(r.ok ? 'PASS' : 'FAIL', name, JSON.stringify(r).slice(0, 400))
  await context.close()
}
const row = (page, title) => page.locator('.editor-task', { has: page.locator('.editor-task-title', { hasText: new RegExp(`^${title}`) }) }).first()
const ring = page => page.evaluate(() => { const a = document.activeElement; return { item: a?.textContent?.trim().slice(0, 20), role: a?.getAttribute('role'), outline: a ? getComputedStyle(a).outlineStyle : null } })

// The sequence where WebKit counts a script's focus as visible after a click: a mark's menu opened after another mark's.
await scenario('Clicked open: the first item has focus and no ring; an arrow key brings the ring', async page => {
  await row(page, 'Alpha').locator('.blocked-mark').click(); await wait(800)
  await row(page, 'Charlie').locator('.blocked-mark').click(); await wait(300)
  const clicked = await ring(page)
  await page.keyboard.press('ArrowDown'); await wait(150)
  const arrowed = await ring(page)
  return { ok: clicked.role === 'menuitem' && clicked.outline === 'none' && arrowed.role === 'menuitem' && arrowed.outline === 'solid', clicked, arrowed }
})
await scenario('A row\'s ⋯ clicked: no ring on its first item', async page => {
  await row(page, 'Charlie').hover(); await row(page, 'Charlie').locator('.editor-row-more').click(); await wait(300)
  const clicked = await ring(page)
  return { ok: clicked.role === 'menuitem' && clicked.outline === 'none', clicked }
})
await scenario('Opened from the keyboard: the ring shows at once', async page => {
  await row(page, 'Charlie').locator('.editor-row-more').focus(); await page.keyboard.press('Enter'); await wait(300)
  const keyed = await ring(page)
  return { ok: keyed.role === 'menuitem' && keyed.outline === 'solid', keyed }
})
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
