// Rollback (design §9): a store with formulas, opened on a build from before them. The column shows empty, nothing crashes, other edits work and the text survives.
// Usage: node tests/evidence/formula/older-build.mjs <old-base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const shop = () => store().pages.find(p => p.id === 'shop').database
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
await page.goto(`${base}/pages?page=shop`); await wait(2500)
const r = { columns: (await page.locator('.database-th, th').allInnerTexts()).map(t => t.trim()).filter(Boolean) }
r.pear = (await page.locator('.database-row[data-row="pear"] .database-td:not(.is-title)').allInnerTexts()).map(t => t.trim())
const before = shop().properties.filter(p => p.type === 'formula').map(p => [p.id, p.formula])
await page.locator('.database-row[data-row="pear"] .database-td:not(.is-title)').first().click(); await wait(300)
await page.keyboard.type('9'); await page.keyboard.press('Enter'); await wait(1200)
r.priceStored = store().pages.find(p => p.id === 'pear').values.price
await page.locator('.database-more-button').first().click(); await wait(250)
await page.locator('.database-menu').getByRole('menuitem', { name: 'Properties' }).click(); await wait(250)
r.listed = (await page.locator('.database-menu .database-property-name').allInnerTexts()).map(t => t.replace(/\s+/g, ' '))
await page.keyboard.press('Escape'); await wait(200)
r.textsKept = JSON.stringify(shop().properties.filter(p => p.type === 'formula').map(p => [p.id, p.formula])) === JSON.stringify(before) && before.length > 0
r.errors = errors
r.ok = !errors.length && r.textsKept && r.priceStored !== 2
console.log(r.ok ? 'PASS' : 'FAIL', JSON.stringify(r))
await browser.close()
process.exit(r.ok ? 0 : 1)
