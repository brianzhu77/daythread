// ↑ ↓ follow the view a row was opened from, when the same row is in two views on a page in different orders (Ratchet, side-peek-ratchet.md).
// Usage: node tests/evidence/peek/two-views.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/two-views.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath} && node --no-warnings tests/evidence/peek/seed-two-views.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
await page.goto(`${base}/pages?page=books`); await wait(2300)
const blocks = page.locator('.app-main .database-block'), peek = page.locator('.peek')
const orders = await blocks.evaluateAll(all => all.map(b => [...new Set([...b.querySelectorAll('[data-row]')].map(r => r.dataset.row))]))
const row = orders[0].find((id, i) => orders[1].includes(id) && i < orders[0].length - 1 && orders[1][orders[1].indexOf(id) + 1] !== orders[0][i + 1])
check(orders.length === 2 && Boolean(row), 'the same row is in two views, with a different row after it', row)
const walk = async (n, list) => {
  const start = blocks.nth(n).locator(`tr[data-row="${row}"]`)
  await start.locator('.database-title-cell').hover(); await start.locator('.database-open').click(); await wait(900)
  const next = peek.getByRole('button', { name: 'Next row' })
  const expected = list[list.indexOf(row) + 1]
  if (expected) { await next.click(); await wait(800) }
  const actual = new URL(page.url()).searchParams.get('peek')
  check(!expected || actual === expected, `from view ${n + 1}, ↓ follows that view`, { expected, actual })
  await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(600)
}
await walk(0, orders[0])
await walk(1, orders[1])
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
