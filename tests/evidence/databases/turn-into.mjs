// R1 Turn into page and back (design §3.2), fresh store (reseeded): the table becomes a page card (a full page under
// Books, nothing trashed), then the card's ⋯ → Turn into inline makes it the table again, with the new block as home.
// Usage: node tests/evidence/databases/turn-into.mjs <base-url> [chromium|webkit], dev server on /tmp/rb-dbui/ws.sqlite.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
execSync('rm -f /tmp/rb-dbui/ws.sqlite && node tests/evidence/databases/seed-table.ts /tmp/rb-dbui/ws.sqlite', { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 /tmp/rb-dbui/ws.sqlite "select data from workspace"`).toString())
const base = process.argv[2], engine = process.argv[3] ?? 'chromium'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const db = () => { const ws = store(); const list = ws.pages.find(p => p.id === 'list'); const doc = JSON.parse(ws.pages.find(p => p.id === 'books').document); return { home: list.database.homeBlockId, trashed: Boolean(list.trashedAt), parent: list.parentId, types: doc.map(n => n.type).join(','), homeIsBlock: doc.some(n => n.id === list.database.homeBlockId && n.type === 'database') } }
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
await page.locator('.database-more-button').first().click()
await page.locator('.database-menu').getByRole('menuitem', { name: 'Turn into page' }).click(); await page.waitForTimeout(2500)
const asPage = db()
await page.locator('.editor-page-card-row').first().hover(); await page.waitForTimeout(300)
await page.locator('.editor-card-menu .editor-row-more').first().click()
await page.getByRole('menuitem', { name: 'Turn into inline' }).click(); await page.waitForTimeout(2500)
const asInline = db()
const rows = await page.locator('.database-row').count()
console.log(JSON.stringify({ asPage, asInline, rows, errors }))
const ok = asPage.home === null && !asPage.trashed && asPage.parent === 'books' && asPage.types.includes('pageLink') && asInline.homeIsBlock && !asInline.trashed && rows === 3 && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
