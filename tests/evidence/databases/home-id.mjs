// R1 (model §9, Lead 7b3b9664): the home block keeps its id, and nothing is trashed, after a side-menu drag, the move shortcut ⌘⇧↑/↓ on
// the line next to it and on the block itself, and an IME composition on the line next to it. Fresh store (reseeded).
// Usage: node tests/evidence/databases/home-id.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/home-id.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const state = () => { const ws = store(); const doc = JSON.parse(ws.pages.find(p => p.id === 'books').document); const db = ws.pages.find(p => p.id === 'list'); return { order: doc.map(n => n.type === 'database' ? `db:${n.id}` : (n.content ?? []).map(c => c.text).join('')).filter(Boolean).join(' | '), home: db.database.homeBlockId, homeInDoc: doc.some(n => n.id === db.database.homeBlockId), trashed: Boolean(db.trashedAt) } }
const out = {}
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
out.start = state()
// ⌘⇧↑ (BlockNote's move shortcut) on the line below the table: the line moves above it.
await page.getByText('After the table').click(); await page.keyboard.press('Meta+Shift+ArrowUp'); await page.waitForTimeout(2000)
out.lineUp = state()
// The block itself selected (↓ from the line now above it), then ⌘⇧↑ and ⌘⇧↓.
await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200)
await page.keyboard.press('Meta+Shift+ArrowUp'); await page.waitForTimeout(2000); out.blockUp = state()
await page.keyboard.press('Meta+Shift+ArrowDown'); await page.waitForTimeout(2000); out.blockDown = state()
// Side-menu drag of the table to the top of the page.
const block = page.locator('.bn-block-outer:has(.database-block)').first()
await block.hover({ position: { x: 20, y: 10 } }); await page.waitForTimeout(400)
const handle = page.locator('.editor-handle button').first()
const first = page.locator('.bn-block-outer').first()
if (await handle.count()) { await handle.dragTo(first, { targetPosition: { x: 40, y: 2 } }); await page.waitForTimeout(2500); out.drag = state() } else out.drag = 'no handle'
// IME on the line next to it (Chromium only: CDP composition).
if (engine === 'chromium') {
  await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.imeSetComposition', { text: 'nih', selectionStart: 3, selectionEnd: 3 })
  await cdp.send('Input.insertText', { text: '你好' })
  await page.waitForTimeout(2500); out.ime = state()
}
out.errors = errors
console.log(JSON.stringify(out, null, 1))
const steps = [out.lineUp, out.blockUp, out.blockDown, out.drag, ...(out.ime ? [out.ime] : [])]
const ok = steps.every(s => typeof s === 'object' && s.home === out.start.home && s.homeInDoc && !s.trashed) && !errors.length
  && out.lineUp.order !== out.start.order && out.drag.order.startsWith('db:')
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
