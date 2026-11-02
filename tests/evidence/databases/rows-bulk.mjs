// R1-11 at 1280, fresh store (reseeded): rows drag by ⋮⋮ in an unsorted view (Ubik to the top), and not when sorted;
// several rows picked (click, then Shift-click for a range) get the bar; Edit property ▾ → Owned → Check all sets it on
// each; Delete sends the picked rows to Trash as one batch, with Undo.
// Usage: node tests/evidence/databases/rows-bulk.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/rows-bulk.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const ws = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const order = () => ws().pages.filter(p => p.parentId === 'list' && !p.trashedAt).map(p => p.title)
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const row = (title) => page.locator('.database-row', { hasText: title }).first()
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
// Drag Ubik above Dune.
await row('Ubik').hover(); await page.waitForTimeout(200)
const handle = row('Ubik').locator('.database-row-handle'), target = await row('Dune').boundingBox()
const h = await handle.boundingBox()
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(h.x + 5, target.y + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1500)
out.dragged = order()
// Pick Ubik, Shift-pick Emma (a range of three), Edit property ▾ → Owned → Check all.
await row('Ubik').hover(); await row('Ubik').locator('.database-row-pick').click()
await row('Emma').hover(); await row('Emma').locator('.database-row-pick').click({ modifiers: ['Shift'] })
out.bar = (await page.locator('.database-picked-bar').innerText().catch(() => '')).replace(/\s+/g, ' ')
await page.getByRole('button', { name: 'Edit property ▾' }).click(); await page.locator('.database-picked-menu').getByRole('menuitem', { name: 'Owned' }).click()
await page.getByRole('button', { name: 'Check all', exact: true }).click(); await page.waitForTimeout(1500)
out.owned = ws().pages.filter(p => p.parentId === 'list').map(p => `${p.title}:${p.values?.owned === true}`)
// Delete them, then Undo.
await page.locator('.database-picked-bar').getByRole('button', { name: 'Delete' }).click(); await page.waitForTimeout(1500)
out.afterDelete = order()
await page.getByRole('button', { name: 'Undo' }).last().click(); await page.waitForTimeout(1500)
out.afterUndo = order()
// Sorted: no handle.
await page.locator('.database-more-button').first().click(); await page.locator('.database-menu').getByRole('button', { name: 'Sort' }).click()
await page.locator('.database-menu').getByText('+ Add sort').click(); await page.waitForTimeout(1000); await page.keyboard.press('Escape')
await row('Dune').hover(); out.handleWhenSorted = await row('Dune').locator('.database-row-handle').count()
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.dragged.join() === 'Ubik,Dune,Emma' && /^3 rows Edit property ▾ Delete Done/.test(out.bar) && out.owned.every(x => x.endsWith('true'))
  && out.afterDelete.length === 0 && out.afterUndo.join() === 'Ubik,Dune,Emma' && out.handleWhenSorted === 0 && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
