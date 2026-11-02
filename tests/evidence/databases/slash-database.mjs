// R1: `/` Database on a page makes an inline database: block in, title focused, Enter goes to a first row's Name.
// Usage: node tests/evidence/databases/slash-database.mjs <base-url> [chromium|webkit], on a store from seed-table.ts.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const base = process.argv[2], engine = process.argv[3] ?? 'chromium'
const store = () => JSON.parse(execSync(`sqlite3 /tmp/rb-dbui/ws.sqlite "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(`${base}/pages?page=books`)
await page.waitForTimeout(2500)
await page.getByText('After the table').click()
await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
await page.keyboard.type('/database'); await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
const focused = await page.evaluate(() => document.activeElement?.className)
await page.keyboard.type('Films to see'); await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
await page.keyboard.type('Alien'); await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
const ws = store()
const db = ws.pages.find(p => p.title === 'Films to see')
const books = JSON.parse(ws.pages.find(p => p.id === 'books').document)
const block = books.find(n => n.type === 'database' && n.props.pageId === db?.id)
const rows = db ? ws.pages.filter(p => p.parentId === db.id).map(p => p.title) : []
const out = { focused, db: Boolean(db), parent: db?.parentId, home: db?.database?.homeBlockId === block?.id, rows, errors }
console.log(JSON.stringify(out))
const ok = focused?.includes('database-title') && db && out.parent === 'books' && out.home && rows.join() === 'Alien' && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
