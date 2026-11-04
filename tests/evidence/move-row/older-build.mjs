// Rollback (move-row §7): a moved row on a build from before the command. It reads as an ordinary row of its new database.
// Usage: node tests/evidence/move-row/older-build.mjs <old-base-url> <store-path> [chromium|webkit]  (a store where `dune` was already moved)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
await page.goto(`${base}/pages?page=same`); await wait(2500)
const r = { cells: (await page.locator('.database-row[data-row="dune"] .database-td').allInnerTexts()).map(t => t.trim()) }
const before = store().pages.find(p => p.id === 'dune').values.pages3
await page.locator('.database-row[data-row="dune"] .database-td:not(.is-title)').first().click(); await wait(300)
await page.keyboard.type('1'); await page.keyboard.press('Enter'); await wait(1300)
r.edited = store().pages.find(p => p.id === 'dune').values.pages3
await page.goto(`${base}/pages?page=books`); await wait(1800)
r.oldShows = await page.locator('.database-row[data-row="dune"]').count()
r.errors = errors
r.ok = !errors.length && r.cells.includes(String(before)) && r.edited === Number(`${before}1`) && r.oldShows === 0
console.log(r.ok ? 'PASS' : 'FAIL', JSON.stringify(r))
await browser.close()
process.exit(r.ok ? 0 : 1)
