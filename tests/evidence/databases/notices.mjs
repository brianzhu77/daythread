// R1 notices and returns, fresh store (reseeded):
// - Backspace on the selected home block: "Reading list and its 3 rows moved to Trash · Undo", and Undo brings the block,
//   the database and its rows back (R1-15).
// - Cutting the home block: "Reading list is now its own page · paste to put it back" (R1-5).
// - Back from a row tints it (design §5, R1-10).
// - At 390, + New opens the new row's page with the caret in its title (R1-7).
// Usage: node tests/evidence/databases/notices.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/notices.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const ws = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const toasts = async () => (await page.locator('[role=alert], [role=status]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
const selectBlock = async () => { await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200) }
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
// Backspace, then Undo from the notice.
await selectBlock(); await page.keyboard.press('Backspace'); await page.waitForTimeout(2500)
out.deleteNotice = (await toasts()).find(t => t.includes('moved to Trash')) ?? ''
out.trashed = Boolean(ws().pages.find(p => p.id === 'list').trashedAt)
await page.getByRole('button', { name: 'Undo' }).last().click(); await page.waitForTimeout(3000)
let w = ws()
out.undone = { trashed: Boolean(w.pages.find(p => p.id === 'list').trashedAt), rows: w.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, table: await page.locator('.database-row').count() }
// Back from a row.
await page.locator('.database-title-cell', { hasText: 'Emma' }).click(); await page.waitForTimeout(1500)
await page.goBack(); await page.waitForTimeout(600)
out.tinted = await page.locator('.database-row.is-returned').innerText().then(t => t.trim().split('\n')[0]).catch(() => '')
// Cut.
await page.waitForTimeout(1000)
await selectBlock(); await page.keyboard.press('Meta+x'); await page.waitForTimeout(1500)
out.cutNotice = (await toasts()).find(t => t.includes('is now its own page')) ?? ''
// Phone + New.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
await phone.goto(`${base}/pages?page=books`); await phone.waitForTimeout(2500)
await phone.locator('.database-new').tap(); await phone.waitForTimeout(2500)
out.phoneNew = { url: phone.url().replace(base, ''), focused: await phone.evaluate(() => document.activeElement?.className ?? '') }
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.deleteNotice.startsWith('Reading list and its 3 rows moved to Trash') && out.trashed && !out.undone.trashed && out.undone.rows === 3 && out.undone.table === 3
  && out.tinted === 'Emma' && out.cutNotice.startsWith('Reading list is now its own page · paste to put it back') && /focus=title/.test(out.phoneNew.url) && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
