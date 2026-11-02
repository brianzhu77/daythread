// A key on a cell is the table's, even when the page's selection still holds the block or a line (design §10): Esc, Enter,
// then Backspace on a cell left the block deleted. Selected whole, Backspace still deletes it (§9.3).
// Usage: node tests/evidence/databases/block-keys.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/databases/block-keys.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
// WebKit reports a request cut off by leaving the page as an error.
const errors = []; page.on('pageerror', e => { if (!/access control checks/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const doc = () => store().pages.find(p => p.id === 'books').document
// What the page holds, line by line; a save as the page settles may rewrite ids and empty props.
const lines = () => JSON.parse(doc()).map(n => n.type === 'database' ? `database:${n.id}` : (n.content ?? []).map(c => c.text).join('')).join(' | ')
// A fresh store each time: on a build with the bug, a step takes the block away.
const fresh = async () => { execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' }); await page.goto(`${base}/pages?page=books`); await wait(2500) }
const name = () => page.locator('.database-title-cell').first()
await fresh()
// Saved as the page settles; the same in every fresh store but for its database's ids.
const doc0 = lines()
await name().focus(); await page.keyboard.press('Escape'); await wait(300)
await page.keyboard.press('Enter'); await wait(300)
check(await page.evaluate(() => document.activeElement?.classList.contains('database-title-cell')), 'Esc, Enter: back on the first cell')
await page.keyboard.press('Backspace'); await wait(900)
check(lines() === doc0 && await page.locator('.database-table').count() === 1, 'Backspace on a cell leaves the block', { lines: lines(), tables: await page.locator('.database-table').count() })
if (process.env.SHOW_AFTER) {
  const list = () => store().pages.find(p => p.id === 'list')
  console.log('after', { lines: lines(), before: doc0, trashed: Boolean(list().trashedAt), rows: store().pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, notices: await page.locator('[data-slot="toast"]').allInnerTexts() })
  const undo = page.getByRole('button', { name: 'Undo' }).first()
  if (await undo.count()) { await undo.click(); await wait(1500); console.log('after Undo', { lines: lines(), trashed: Boolean(list().trashedAt), rows: store().pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, table: await page.locator('.database-table').count() }) }
}
await fresh()
await name().focus(); await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
await page.keyboard.press('Delete'); await wait(900)
check(lines() === doc0 && await page.locator('.database-table').count() === 1, 'and so does Delete')
await fresh()
await name().focus(); await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
await page.keyboard.press('ControlOrMeta+a'); await wait(200); await page.keyboard.press('/'); await wait(900)
check(lines() === doc0 && await page.locator('.database-table').count() === 1, '⌘A then / too')
// The mouse route: the block selected, a cell clicked open and closed, then Backspace.
await fresh()
await name().focus(); await page.keyboard.press('Escape'); await wait(300)
await page.locator('tr[data-row="dune"] td.is-select .database-cell').click(); await wait(600); await page.keyboard.press('Escape'); await wait(400)
const active = await page.evaluate(() => document.activeElement?.className?.toString().slice(0, 30))
await page.keyboard.press('Backspace'); await wait(900)
check(lines() === doc0 && await page.locator('.database-table').count() === 1, 'by mouse too: a cell opened and closed, then Backspace, leaves the block', { active })
// Typing on a cell that doesn't take text.
await fresh()
await name().focus(); await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
await page.keyboard.press('Tab'); await wait(200)
await page.keyboard.type('zz'); await wait(1000)
check(lines() === doc0 && await page.locator('.database-table').count() === 1, 'letters on a Select cell type nothing into the page', lines())
await page.keyboard.press('Escape'); await wait(300)
// The cell still gets its keys: Delete clears a value, once, and only that.
await fresh()
const before = store().pages.find(p => p.id === 'dune').values
await page.locator('tr[data-row="dune"] td.is-number .database-cell').focus(); await page.keyboard.press('Escape'); await wait(300); await page.keyboard.press('Enter'); await wait(300)
await page.locator('tr[data-row="dune"] td.is-number .database-cell').focus(); await page.keyboard.press('Delete'); await wait(1200)
const after = store().pages.find(p => p.id === 'dune').values
check(lines() === doc0 && Object.keys(before).filter(k => before[k] !== after[k] && JSON.stringify(before[k]) !== JSON.stringify(after[k])).length === 1, 'Delete on a cell clears that cell', Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])))
// A caret left in a line of the page: a key on a cell doesn't reach that line.
await fresh()
const line = page.locator('.bn-inline-content').first(); await line.click(); await page.keyboard.press('End'); await wait(200)
await name().focus(); await page.keyboard.press('Backspace'); await wait(1500)
check(lines() === doc0, "a caret in a line isn't typed into from a cell")
// Selected whole, Backspace still deletes it, with Undo (§9.3).
await fresh()
await name().focus(); await page.keyboard.press('Escape'); await wait(300)
await page.keyboard.press('Backspace'); await wait(1200)
check(!doc().includes('"type":"database"'), 'selected whole, Backspace deletes the block')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
