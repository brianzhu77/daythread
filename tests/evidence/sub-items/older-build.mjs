// Rollback (sub-items design §6): a database with sub-items on, on a build from before them. They read as plain relations, nothing's lost.
// Usage: node tests/evidence/sub-items/older-build.mjs <old-base-url> <store-path> [chromium|webkit]  (a store seeded with `on`)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const before = store()
await page.goto(`${base}/pages?page=work`); await wait(2500)
const r = { titles: await page.locator('.database-row .database-title-cell').allInnerTexts() }
const edited = Number(store().pages.find(p => p.id === 'kid').values.n)
await page.locator('.database-row[data-row="kid"] .database-td:not(.is-title)').first().click(); await wait(300)
await page.keyboard.type('1'); await page.keyboard.press('Enter'); await wait(1300)
const after = store()
r.edited = after.pages.find(p => p.id === 'kid').values.n
r.settingKept = JSON.stringify(after.pages.find(p => p.id === 'work').database.subItems) === JSON.stringify(before.pages.find(p => p.id === 'work').database.subItems)
r.linksKept = JSON.stringify(after.pages.find(p => p.id === 'kid').values.par) === JSON.stringify(before.pages.find(p => p.id === 'kid').values.par)
r.errors = errors
r.ok = !errors.length && r.titles.length === 8 && r.edited === Number(`${edited}1`) && r.settingKept && r.linksKept
console.log(r.ok ? 'PASS' : 'FAIL', JSON.stringify(r))
await browser.close()
process.exit(r.ok ? 0 : 1)
