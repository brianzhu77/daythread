// R1 part 2: on a store from seed-table.ts, a Number cell edit, a checkbox tick and + New (named) save, and the host page's
// document is untouched (keys stay in the table). Usage: node tests/evidence/databases/table-edit.mjs <base-url> [chromium|webkit]
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
const docBefore = store().pages.find(p => p.id === 'books').document
// Number cell: Emma's Pages 300 -> 320
await page.locator('.database-row').nth(1).locator('.database-td.is-number .database-cell').click()
await page.waitForTimeout(300)
await page.keyboard.press('Meta+A'); await page.keyboard.type('320'); await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
// Checkbox: Emma owned
await page.locator('.database-row').nth(1).locator('.database-td.is-checkbox [role=checkbox], .database-td.is-checkbox button, .database-td.is-checkbox input').first().click()
await page.waitForTimeout(1200)
// New row, named
await page.locator('.database-new').click()
await page.waitForTimeout(1200)
await page.keyboard.type('Neuromancer'); await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
const ws = store()
const emma = ws.pages.find(p => p.id === 'emma')
const rows = ws.pages.filter(p => p.parentId === 'list').map(p => p.title)
console.log('emma', JSON.stringify(emma.values), 'rows', JSON.stringify(rows))
console.log('page doc unchanged', ws.pages.find(p => p.id === 'books').document === docBefore)
await page.screenshot({ path: `/tmp/rb-dbui/edit-${engine}.png` })
console.log('errors', JSON.stringify(errors))
await browser.close()
