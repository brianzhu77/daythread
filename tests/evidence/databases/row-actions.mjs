// R1 row page ⋯ and Trash (design §5, §12), fresh store (reseeded): Duplicate row opens the copy (values copied, title
// "(copy)"); Delete row goes back to the database; after the database is deleted too, Trash lists it "with N rows" and
// the row with "Restores Reading list too", and that Restore brings both back with the row in its database.
// Usage: node tests/evidence/databases/row-actions.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/row-actions.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const menu = async (name) => { await page.locator('.page-more').first().click(); await page.getByRole('menuitem', { name }).click() }
await page.goto(`${base}/pages?page=dune`); await page.waitForTimeout(2500)
out.items = await (async () => { await page.locator('.page-more').first().click(); const t = await page.getByRole('menuitem').allInnerTexts(); await page.keyboard.press('Escape'); return t })()
await menu('Duplicate row'); await page.waitForTimeout(2000)
let ws = store()
const copy = ws.pages.find(p => p.title === 'Dune (copy)')
out.copy = { exists: Boolean(copy), values: JSON.stringify(copy?.values) === JSON.stringify(ws.pages.find(p => p.id === 'dune').values), opened: page.url().includes(copy?.id ?? 'x') }
await menu('Delete row'); await page.waitForTimeout(2000)
ws = store()
out.deleted = { copyTrashed: Boolean(ws.pages.find(p => p.id === copy?.id)?.trashedAt), back: page.url().includes('page=list') }
await page.locator('.database-more-button').first().click(); await page.locator('.database-menu').getByRole('menuitem', { name: 'Delete database' }).click(); await page.waitForTimeout(2000)
await page.goto(`${base}/pages?view=trash`); await page.waitForTimeout(2000)
out.trash = (await page.locator('.trash-row').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())
await page.locator('.trash-row', { hasText: 'Dune (copy)' }).getByRole('button', { name: 'Restore' }).click(); await page.waitForTimeout(2000)
ws = store()
out.restored = { list: !ws.pages.find(p => p.id === 'list').trashedAt, copy: !ws.pages.find(p => p.id === copy?.id).trashedAt, parent: ws.pages.find(p => p.id === copy?.id).parentId }
out.errors = errors
console.log(JSON.stringify(out))
const ok = !out.items.some(t => /Move/.test(t)) && out.items.includes('Duplicate row') && out.copy.exists && out.copy.values && out.copy.opened && out.deleted.copyTrashed && out.deleted.back
  && out.trash.some(t => /Reading list.*with 3 rows/.test(t)) && out.trash.some(t => /Dune \(copy\).*Restores Reading list too/.test(t)) && out.restored.list && out.restored.copy && out.restored.parent === 'list' && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
