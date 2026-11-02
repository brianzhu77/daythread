// R1 keys at 1280 (design §10), on a fresh store (reseeded): ↓ from the line above stops on the block once, ↓ again
// leaves it; Enter goes into the first cell; arrows move; Delete clears a cell and ⌘Z in the table undoes it; Esc gives
// the block back selected; typing on a text cell replaces its value; "/", "[[", Backspace and Enter typed in the title
// never reach the page editor.
// Usage: node tests/evidence/databases/keys.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/keys.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const out = {}
const focused = () => page.evaluate(() => { const a = document.activeElement; return a?.getAttribute('data-nav') ?? (a?.closest('.ProseMirror') ? `editor:${document.querySelector('.ProseMirror-selectednode') ? 'block' : 'text'}` : a?.className) })
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
const doc0 = store().pages.find(p => p.id === 'books').document
await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight')
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); out.down1 = await focused()
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); out.down2 = await focused()
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(200); out.up = await focused()
await page.keyboard.press('Enter'); await page.waitForTimeout(200); out.enter = await focused()
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200); out.moved = await focused()
// 1:2 is Emma's Pages (300): Delete clears it, ⌘Z brings it back.
await page.keyboard.press('Delete'); await page.waitForTimeout(1200); out.cleared = store().pages.find(p => p.id === 'emma').values.pages ?? null
await page.keyboard.press('Meta+z'); await page.waitForTimeout(1200); out.undone = store().pages.find(p => p.id === 'emma').values.pages ?? null
await page.keyboard.press('Escape'); await page.waitForTimeout(300); out.esc = await focused()
// Typing on a text cell replaces its value: Dune's Notes (0:8).
await page.keyboard.press('Enter'); await page.waitForTimeout(200)
for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
out.notesCell = await focused()
await page.keyboard.type('Zed'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500)
out.replaced = store().pages.find(p => p.id === 'dune').values.notes
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
// Title: keys stay in it.
await page.locator('.database-title').first().click(); await page.keyboard.press('Meta+ArrowRight')
await page.keyboard.type(' /x [[y'); await page.keyboard.press('Backspace'); await page.waitForTimeout(500)
out.slashMenu = await page.locator('.bn-suggestion-menu, [class*=suggestion-menu]').count()
await page.keyboard.press('Enter'); await page.waitForTimeout(1500)
const ws = store()
out.title = ws.pages.find(p => p.id === 'list').title
out.docSame = ws.pages.find(p => p.id === 'books').document === doc0
out.errors = errors
console.log(JSON.stringify(out))
const ok = out.down1 === 'editor:block' && out.down2 === 'editor:text' && out.up === 'editor:block' && out.enter === '0:0' && out.moved === '1:2'
  && out.cleared === null && out.undone === 300 && out.esc === 'editor:block' && out.notesCell === '0:8' && out.replaced === 'Zed' && out.slashMenu === 0 && out.title === 'Reading list /x [[' && out.docSame && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
