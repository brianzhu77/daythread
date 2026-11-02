// Copy, cut and paste with the cell cursor on a table cell (design §10, §6.3): they're about the cell, and never touch the block.
// Usage: node tests/evidence/databases/cell-clipboard.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway SQLite file, reseeded for each scenario)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/cell-clipboard.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const out = {}
const state = () => {
  const ws = store(), list = ws.pages.find(p => p.id === 'list'), dune = ws.pages.find(p => p.id === 'dune')
  return { trashed: Boolean(list.trashedAt), home: list.database.homeBlockId, block: JSON.parse(ws.pages.find(p => p.id === 'books').document).some(n => n.type === 'database' && n.id === 'home'), rows: ws.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, name: dune.title, notes: dune.values.notes ?? null, pages: dune.values.pages ?? null, genre: dune.values.genre ?? null, title: list.title }
}
const intact = s => !s.trashed && s.home === 'home' && s.block && s.rows === 3
// Column of the first row, from Name (0): Status 1, Pages 2, Genre 3, Tags 4, Due 5, Owned 6, Link 7, Notes 8.
const scenario = async (name, column, text, act, check) => {
  execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
  // The clipboard, the same way in both engines: a real copy out of a field.
  if (text !== null) {
    await page.evaluate(t => { const a = document.createElement('textarea'); a.id = 'clip'; a.value = t; document.body.append(a); a.select() }, text)
    await page.keyboard.press('Meta+c'); await page.evaluate(() => document.getElementById('clip').remove())
  }
  const cell = async c => { await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await wait(200); await page.keyboard.press('Enter'); await wait(200); for (let i = 0; i < c; i++) await page.keyboard.press('ArrowRight') }
  await cell(column)
  const tools = { press: k => page.keyboard.press(k), page, wait }
  await act(tools); await wait(1800)
  const s = state(), notice = (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')
  const ok = check(s, notice) && !errors.length
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...s, notice: notice.slice(0, 120), errors }))
  await context.close()
  return ok
}
const paste = ({ press }) => press('Meta+v')
const results = [
  await scenario('paste one line', 8, 'single', paste, (s, n) => intact(s) && s.notes === 'single' && !/first line/.test(n)),
  await scenario('paste several lines', 8, 'one\ntwo\nthree', paste, (s, n) => intact(s) && s.notes === 'one' && /Pasted the first line only/.test(n)),
  await scenario('paste into Name', 0, 'Arrakis', paste, s => intact(s) && s.name === 'Arrakis'),
  await scenario('paste a number', 2, '1,024', paste, s => intact(s) && s.pages === 1024),
  await scenario('paste words into a number', 2, 'many', paste, (s, n) => intact(s) && s.pages === 412 && /Can't paste/.test(n)),
  await scenario('paste an option by name', 3, 'essay', paste, s => intact(s) && s.genre === 'essay'),
  await scenario('select all, then paste', 8, 'after all', async ({ press, wait }) => { await press('Meta+a'); await wait(150); await press('Meta+v') }, s => intact(s) && s.notes === 'after all'),
  await scenario('copy, then paste into another cell', 8, null, async ({ press, wait, page }) => { await press('Meta+c'); await wait(100); await press('ArrowDown'); await wait(100); await press('Meta+v'); await wait(800); out.emma = store().pages.find(p => p.id === 'emma').values.notes }, s => intact(s) && s.notes === 'Spice' && out.emma === 'Spice'),
  await scenario('cut, then paste into another cell', 8, null, async ({ press, wait }) => { await press('Meta+x'); await wait(800); await press('ArrowDown'); await wait(100); await press('Meta+v'); await wait(800); out.emma = store().pages.find(p => p.id === 'emma').values.notes }, s => intact(s) && s.notes === null && out.emma === 'Spice'),
  await scenario('cut on Name keeps it', 0, null, ({ press }) => press('Meta+x'), s => intact(s) && s.name === 'Dune'),
  // Reached by the mouse (Bumblebee's probe: both routes): open the cell, Esc, then the same keys.
  await scenario('by mouse: paste', 0, 'by mouse', async ({ page, press, wait }) => { await page.getByText('After the table').click(); await page.locator('.database-row[data-row=dune] .database-td.is-text .database-cell').click(); await wait(300); await press('Escape'); await wait(200); await press('Meta+v') }, s => intact(s)),
  await scenario('by mouse: cut', 0, null, async ({ page, press, wait }) => { await page.getByText('After the table').click(); await page.locator('.database-row[data-row=dune] .database-td.is-text .database-cell').click(); await wait(300); await press('Escape'); await wait(200); await press('Meta+x') }, s => intact(s)),
  await scenario('paste into the database title', 0, ' list', async ({ page, press, wait }) => { await page.locator('.database-title').first().click(); await press('Meta+ArrowRight'); await press('Meta+v'); await wait(100); await page.getByText('After the table').click() }, s => intact(s) && s.title === 'Reading list list'),
]
await browser.close()
const failed = results.filter(x => !x).length
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
