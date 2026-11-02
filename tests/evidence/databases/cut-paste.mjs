// R1 copy and cut of a database block (Jazz §6.3.12, model §3 rules 6-7), fresh store (reseeded):
// copy + paste makes a page card to the same database (no second database); cut on Books + paste on today's page
// moves the database there (its home is the pasted block, nothing trashed, parent today's page), straight away.
// Usage: node tests/evidence/databases/cut-paste.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/cut-paste.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
if (engine === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await context.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const selectBlock = async () => { await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200) }
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
// Copy, paste on a new line after the table.
await selectBlock(); await page.keyboard.press('Meta+c')
await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
await page.keyboard.press('Meta+v'); await page.waitForTimeout(2500)
let ws = store()
let books = JSON.parse(ws.pages.find(p => p.id === 'books').document)
out.copy = { cards: books.filter(n => n.type === 'pageLink' && n.props.pageId === 'list').length, databases: ws.pages.filter(p => p.database).length, blocks: books.filter(n => n.type === 'database').length }
// Cut, then paste on today's page at once.
await selectBlock(); await page.keyboard.press('Meta+x'); await page.waitForTimeout(300)
await page.goto(`${base}/`); await page.waitForTimeout(2500)
await page.locator('.bn-block-outer .bn-inline-content').last().click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
await page.keyboard.press('Meta+v'); await page.waitForTimeout(3000)
ws = store()
const list = ws.pages.find(p => p.id === 'list')
const host = ws.pages.find(p => p.id === list.parentId)
out.cut = { parent: host?.type, trashed: Boolean(list.trashedAt), homeInHost: JSON.parse(host.document).some(n => n.id === list.database.homeBlockId && n.type === 'database'), rows: ws.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length,
  leftInBooks: JSON.parse(ws.pages.find(p => p.id === 'books').document).filter(n => n.type === 'database').length }
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.copy.cards === 1 && out.copy.databases === 2 && out.copy.blocks === 1 && out.cut.parent === 'daily' && !out.cut.trashed && out.cut.homeInHost && out.cut.rows === 3 && out.cut.leftInBooks === 0 && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
