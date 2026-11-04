// R4-9: a grid from a spreadsheet into a table at 1280: across and down from the selected cell, new rows, one Undo, nothing in the page.
// Usage: node tests/evidence/csv/paste.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/csv/paste.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const scenario = async (name, act) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/csv/seed.ts ${storePath} all`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=books`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
// Clipboard permissions differ by engine, so the event carries the words, as a paste's does.
const paste = (page, text) => page.evaluate(words => {
  const data = new DataTransfer(); data.setData('text/plain', words)
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}, text)
const selectCell = async (page, row, column) => { await page.locator(`.database-row[data-row="${row}"] [data-nav$=":${column}"]`).first().focus(); await wait(100) }
const values = id => store().pages.find(p => p.id === id).values ?? {}
const rowsOf = () => store().pages.filter(p => p.parentId === 'books' && !p.trashedAt)
await scenario('A grid fills across and down, makes a row, says what it did, and one Undo takes it back', async page => {
  const before = rowsOf().length
  await selectCell(page, 'dune', 1)
  await paste(page, '1\t2026-02-01\n2\t2026-02-02\n3\t2026-02-03\n4\t2026-02-04\n')
  await wait(1500)
  const r = { notice: await notices(page), dune: values('dune'), emma: values('emma'), count: rowsOf().length - before, made: rowsOf().at(-1) && values(rowsOf().at(-1).id) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.undone = values('dune'); r.afterUndo = rowsOf().length - before
  await selectCell(page, 'dune', 4)
  await paste(page, '"two\nnew lines"\tSF\nplain\tHistory'); await wait(1500)
  r.quoted = values('dune').notes; r.tagged = values('emma').tags
  r.ok = /8 cells pasted/.test(r.notice) && r.dune.pages === 1 && r.dune.read.start === '2026-02-01' && r.dune.owned === true && r.emma.pages === 2 && r.count === 1 && r.made.pages === 4 && r.undone.pages === 412 && r.afterUndo === 0 && r.quoted === 'two\nnew lines' && r.tagged?.join() === 'hist'
  return r
})
await scenario('What can\'t convert, is read-only or doesn\'t fit is counted', async page => {
  await selectCell(page, 'dune', 1)
  await paste(page, 'many\t2026-01-05\tYes\tkept\tSF\tno column\tnor this')
  await wait(1500)
  const r = { notice: await notices(page), dune: values('dune') }
  r.ok = /4 cells pasted/.test(r.notice) && /1 couldn't convert/.test(r.notice) && /2 didn't fit/.test(r.notice) && r.dune.pages === 412 && r.dune.read?.start === '2026-01-05' && r.dune.notes === 'kept'
  return r
})
await scenario('A single value still sets one cell, past 1,000 cells nothing is pasted, and the page gets none of it', async page => {
  const lines = () => JSON.parse(store().pages.find(p => p.id === 'books').document).length
  const before = lines()
  await selectCell(page, 'dune', 1)
  await paste(page, '77'); await wait(1200)
  const r = { one: values('dune').pages, emma: values('emma').pages }
  await paste(page, Array.from({ length: 300 }, () => 'a\tb\tc\td').join('\n')); await wait(800)
  r.tooMany = await notices(page); r.rows = rowsOf().length; r.linesAdded = lines() - before
  r.ok = r.one === 77 && r.emma === -5 && /1200 cells/.test(r.tooMany) && r.rows === 3 && r.linesAdded === 0
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
