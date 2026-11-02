// R1 Turn into page and back (design §3.2), fresh store (reseeded): the table becomes a page card (a full page under
// Books, nothing trashed); ⌘Z in the page brings the same block back as the table; then the card's ⋯ → Turn into inline makes it the table again, with the new block as home.
// Usage: node tests/evidence/databases/turn-into.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/turn-into.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const db = () => { const ws = store(); const list = ws.pages.find(p => p.id === 'list'); const doc = JSON.parse(ws.pages.find(p => p.id === 'books').document); return { home: list.database.homeBlockId, trashed: Boolean(list.trashedAt), parent: list.parentId, types: doc.map(n => n.type).join(','), homeIsBlock: doc.some(n => n.id === list.database.homeBlockId && n.type === 'database') } }
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
await page.locator('.database-more-button').first().click()
await page.locator('.database-menu').getByRole('menuitem', { name: 'Turn into page' }).click(); await page.waitForTimeout(2500)
const asPage = db()
// ⌘Z in the page right after: the same block comes back, and it is the table again (its home), not a card (Bumblebee).
await page.getByText('After the table').click(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(2500)
const undone = db()
const undoneTable = await page.locator('.database-row').count()
// Turn into page again, for the way back through the card.
await page.locator('.database-more-button').first().click()
await page.locator('.database-menu').getByRole('menuitem', { name: 'Turn into page' }).click(); await page.waitForTimeout(2500)
await page.locator('.editor-page-card-row').first().hover(); await page.waitForTimeout(300)
await page.locator('.editor-card-menu .editor-row-more').first().click()
await page.getByRole('menuitem', { name: 'Turn into inline' }).click(); await page.waitForTimeout(2500)
const asInline = db()
const rows = await page.locator('.database-row').count()
console.log(JSON.stringify({ asPage, undone, undoneTable, asInline, rows, errors }))
const ok = undone.home === 'home' && undone.homeIsBlock && undoneTable === 3 && asPage.home === null && !asPage.trashed && asPage.parent === 'books' && asPage.types.includes('pageLink') && asInline.homeIsBlock && !asInline.trashed && rows === 3 && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
