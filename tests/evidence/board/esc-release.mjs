// Esc during a drag, then letting go: nothing moves and nothing opens, on a Board's card and a Calendar's row (as the Timeline's bar does since #149). A plain click still opens one.
// Usage: node tests/evidence/board/esc-release.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/board/esc-release.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node tests/evidence/board/seed-board.ts ${S} board`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const path = () => new URL(page.url()).search
const drill = async (name, target) => {
  const at = path(), rev = store().revision, b = await target.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 8 }); await wait(150)
  await page.keyboard.press('Escape'); await wait(150); await page.mouse.up(); await wait(900)
  check(path() === at && !/peek=/.test(page.url()), `${name}: Esc then letting go opens nothing`, page.url().slice(-40)); check(store().revision === rev, `${name}: and moves nothing`, store().revision - rev)
  await target.click(); await wait(1200); check(path() !== at, `${name}: a plain click still opens it`, path()); await page.goBack(); await wait(1600)
}
await page.goto(`${base}/pages?page=books`); await wait(2500)
await drill('board', block.locator('.database-card-title').first())
await block.locator('.database-more-button').click(); await wait(250); await menu.getByRole('menuitem', { name: /^Layout/ }).click(); await wait(200); await menu.getByRole('menuitemradio', { name: /^Calendar/ }).click(); await wait(1100); await page.keyboard.press('Escape'); await wait(300)
const row = block.locator('[data-row], .database-calendar-row, .database-calendar-event').first(); await row.waitFor({ timeout: 8000 }).catch(() => {})
if (await row.count()) await drill('calendar', row); else check(false, 'calendar: a row to drag')
console.log(`[esc-release ${engine}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
