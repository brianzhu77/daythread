// R1 §13 states, fresh store (reseeded):
// - Offline: a Number edit stays shown (is-unsaved) with "1 change not saved · Retry · Undo"; back online, Retry saves it.
//   Undo on a second failed edit puts the stored value back.
// - Two tabs: tab B changes a cell; tab A then edits a different cell of the same row (lands, after one quiet resend);
//   B changes the cell again and A, not yet showing it, edits the same cell (refused: the long notice, B's value kept).
// Usage: node tests/evidence/databases/offline-tabs.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/offline-tabs.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const emma = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString()).pages.find(p => p.id === 'emma').values
const browser = await pw[engine].launch({ headless: true })
const out = {}, errors = []
const tab = async (context) => { const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500); return page }
const cell = (page, type) => page.locator('.database-block').first().locator('.database-row').nth(1).locator(`.database-td.is-${type}`)
const typeNumber = async (page, n) => { await cell(page, 'number').locator('.database-cell').click(); await page.waitForTimeout(300); await page.keyboard.press('Meta+A'); await page.keyboard.type(String(n)); await page.keyboard.press('Enter') }
// Offline.
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const a = await tab(ctxA)
await ctxA.setOffline(true)
await typeNumber(a, 333); await a.waitForTimeout(2500)
out.offline = { shown: (await cell(a, 'number').innerText()).trim(), unsaved: await cell(a, 'number').evaluate(el => el.classList.contains('is-unsaved')), strip: (await a.locator('.database-unsaved').innerText().catch(() => '')).replace(/\s+/g, ' '), stored: emma().pages }
await ctxA.setOffline(false)
await a.locator('.database-unsaved').getByRole('button', { name: 'Retry' }).click(); await a.waitForTimeout(2000)
out.retried = { stored: emma().pages, strip: await a.locator('.database-unsaved').count() }
await ctxA.setOffline(true)
await typeNumber(a, 444); await a.waitForTimeout(2500)
await ctxA.setOffline(false)
await a.locator('.database-unsaved').getByRole('button', { name: 'Undo' }).click(); await a.waitForTimeout(800)
out.undone = { shown: (await cell(a, 'number').innerText()).trim(), stored: emma().pages }
// Two tabs.
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const b = await tab(ctxB)
await typeNumber(b, 500); await b.waitForTimeout(1500)
await cell(a, 'text').locator('.database-cell').click(); await a.waitForTimeout(300); await a.keyboard.type('From tab A'); await a.keyboard.press('Enter'); await a.waitForTimeout(2500)
out.otherCell = emma()
// B changes Pages again after A last loaded; A, still showing 500, sets 600: refused, B's 700 kept.
await typeNumber(b, 700); await b.waitForTimeout(1500)
await typeNumber(a, 600); await a.waitForTimeout(3000)
out.sameCell = { stored: emma().pages, notice: (await a.locator('[role=alert], [role=status]').allInnerTexts()).map(t => t.trim()).filter(t => t.includes('changed elsewhere'))[0] ?? '' }
out.errors = errors.filter(e => !/Failed to fetch|NetworkError|Load failed/.test(e))
console.log(JSON.stringify(out))
const ok = out.offline.shown === '333' && out.offline.unsaved && /1 change not saved · Retry · Undo/.test(out.offline.strip) && out.offline.stored === 300 && out.retried.stored === 333 && out.retried.strip === 0
  && out.undone.shown === '333' && out.undone.stored === 333 && out.otherCell.notes === 'From tab A' && out.otherCell.pages === 500
  && out.sameCell.stored === 700 && /Pages in Emma changed elsewhere · yours was 600/.test(out.sameCell.notice) && !out.errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
