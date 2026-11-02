// R1-14 views (design §7.1), fresh store (reseeded): "Table ⌄" lists views; + Add view makes a Table with its name
// ready to rename; each view keeps its own filter; switching views writes nothing (a local preference); Duplicate and
// Delete; the last view has no Delete.
// Usage: node tests/evidence/databases/views.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/views.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const ws = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const titles = () => block.locator('.database-title-cell').allInnerTexts()
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
await block.locator('.database-view-name').click()
await menu.getByRole('menuitem', { name: '+ Add view' }).click(); await page.waitForTimeout(800)
await page.keyboard.press('Meta+A'); await page.keyboard.type('Owned'); await page.keyboard.press('Enter'); await page.waitForTimeout(1000)
await page.keyboard.press('Escape')
out.viewName = (await block.locator('.database-view-name').innerText()).trim()
// A filter on the new view only.
await block.locator('.database-more-button').click(); await menu.getByRole('button', { name: 'Filter' }).click()
await menu.getByText('+ Add filter').click(); await page.waitForTimeout(800)
await menu.getByLabel('Property').last().selectOption({ label: 'Owned' }); await page.waitForTimeout(1000)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
out.ownedRows = await titles()
// Switch back: writes nothing.
const revision = ws().revision
await block.locator('.database-view-name').click(); await menu.getByRole('menuitemradio', { name: /^Table$/ }).click(); await page.waitForTimeout(1000)
out.tableRows = await titles(); out.switchWrote = ws().revision !== revision
// Duplicate Owned, then delete the copy; the last view has no Delete.
await block.locator('.database-view-name').click()
await menu.getByRole('button', { name: 'Owned options' }).click(); await menu.getByRole('menuitem', { name: 'Duplicate' }).click(); await page.waitForTimeout(1000)
await page.keyboard.press('Enter'); await page.waitForTimeout(800)
out.views = ws().pages.find(p => p.id === 'list').database.views.map(v => `${v.name}:${v.filter.length}`)
await menu.getByRole('button', { name: 'Owned (copy) options' }).click(); await menu.getByRole('menuitem', { name: 'Delete' }).click(); await page.waitForTimeout(1000)
await menu.getByRole('button', { name: 'Owned options' }).click(); await menu.getByRole('menuitem', { name: 'Delete' }).click(); await page.waitForTimeout(1000)
await menu.getByRole('button', { name: 'Table options' }).click()
out.lastHasDelete = await menu.getByRole('menuitem', { name: 'Delete' }).count()
out.finalViews = ws().pages.find(p => p.id === 'list').database.views.map(v => v.name)
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.viewName.startsWith('Owned') && out.ownedRows.join() === 'Dune' && out.tableRows.join() === 'Dune,Emma,Ubik' && !out.switchWrote
  && out.views.join() === 'Table:0,Owned:1,Owned (copy):1' && out.lastHasDelete === 0 && out.finalViews.join() === 'Table' && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
