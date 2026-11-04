// A peek closed with its save still on its way (Ratchet, peek-synced-ratchet.md): type in a synced line in the peek, hold the save, close, type in the same line behind, let it go.
// Both sets of words stay and nothing touches the closed editor. Usage: node tests/evidence/peek/close-with-save.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/close-with-save.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/peek/seed-synced.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
const wait = ms => page.waitForTimeout(ms)
let release, seen, once = false
const held = new Promise(r => { release = r }), arrived = new Promise(r => { seen = r })
await page.route('**/_serverFn/**', async route => {
  if (!once && route.request().method() === 'POST' && (route.request().postData() ?? '').includes('unsync-block')) { once = true; seen(); await held }
  await route.continue().catch(() => {})
})
const host = page.locator('.doc-screen').first(), peek = page.locator('.peek')
const type = async (scope, words) => { await scope.locator('.bn-inline-content', { hasText: 'Shared words' }).first().click(); await page.keyboard.press('End'); await page.keyboard.type(words) }
await page.goto(`${base}/pages?page=books`); await wait(2500)
await page.locator('tr[data-row=dune]').hover(); await page.locator('tr[data-row=dune] .database-open').click(); await peek.waitFor(); await wait(700)
await peek.locator('.bn-inline-content', { hasText: 'Shared words' }).first().hover(); await peek.locator('.synced-label-button').first().click(); await page.getByRole('menuitem', { name: 'Unsync here', exact: true }).click(); await arrived
await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(500)
await type(host, ' HOST'); release(); await wait(5500)
const stored = execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
check(stored.includes('HOST'), 'typing behind the closed peek is saved')
check(errors.length === 0, 'nothing touches the closed editor', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
