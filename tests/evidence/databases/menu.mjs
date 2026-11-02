// R1 table menu (design §7.3, §8, §6.2), on a fresh store from seed-table.ts: a filter (rows and the filter line), a
// sort, hiding a property, a new Number property, Turn into page (the table becomes a card, nothing trashed), then
// Delete database from its full page (to Trash, with its rows).
// Usage: node tests/evidence/databases/menu.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/menu.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
// A fresh store each run (the dev server opens the file per request).
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const menu = () => page.locator('.database-menu')
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
const block = page.locator('.database-block').first()
const titles = () => block.locator('.database-title-cell').allInnerTexts()
// Filter: Tags contains SF.
await block.locator('.database-more-button').click()
await menu().getByRole('button', { name: 'Filter' }).click()
await menu().getByText('+ Add filter').click(); await page.waitForTimeout(800)
await menu().getByLabel('Property').last().selectOption({ label: 'Tags' }); await page.waitForTimeout(800)
await menu().getByLabel('SF').last().click(); await page.waitForTimeout(1000)
out.filtered = await titles()
out.filterLine = await block.locator('.database-filter-line').innerText().catch(() => '')
// Sort: Name descending.
await menu().getByLabel('Back').click(); await menu().getByRole('button', { name: 'Sort' }).click()
await menu().getByText('+ Add sort').click(); await page.waitForTimeout(800)
await menu().getByLabel('Direction').last().selectOption('desc'); await page.waitForTimeout(1000)
out.sorted = await titles()
// Properties: hide Notes; add a Number property "Rating".
await menu().getByLabel('Back').click(); await menu().getByRole('menuitem', { name: /Properties/ }).click()
await menu().getByLabel('Show Notes').click(); await page.waitForTimeout(800)
await menu().getByText('+ Add property').click()
await menu().getByLabel('Property name').fill('Rating'); await menu().getByRole('menuitem', { name: 'Number' }).click(); await page.waitForTimeout(1000)
out.headers = await block.locator('.database-th').allInnerTexts()
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
// Turn into page.
await block.locator('.database-more-button').click()
await menu().getByRole('menuitem', { name: 'Turn into page' }).click(); await page.waitForTimeout(3000)
let ws = store()
const books = JSON.parse(ws.pages.find(p => p.id === 'books').document)
out.card = books.some(n => n.type === 'pageLink' && n.props.pageId === 'list')
const list = ws.pages.find(p => p.id === 'list')
out.afterTurn = { trashed: Boolean(list.trashedAt), home: list.database.homeBlockId, parent: list.parentId, filter: list.database.views[0].filter.length, rating: list.database.properties.some(p => p.name === 'Rating' && p.type === 'number') }
// Delete database from its full page.
await page.goto(`${base}/pages?page=list`); await page.waitForTimeout(2000)
await page.locator('.database-more-button').click()
await menu().getByRole('menuitem', { name: 'Delete database' }).click(); await page.waitForTimeout(2000)
ws = store()
out.deleted = { list: Boolean(ws.pages.find(p => p.id === 'list').trashedAt), dune: Boolean(ws.pages.find(p => p.id === 'dune').trashedAt) }
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.filtered.join() === 'Dune,Ubik' && out.sorted.join() === 'Ubik,Dune' && !out.headers.includes('Notes') && out.headers.some(h => h.includes('Rating'))
  && out.card && !out.afterTurn.trashed && out.afterTurn.home === null && out.afterTurn.parent === 'books' && out.deleted.list && out.deleted.dune && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
