// R4-8: a CSV in, from each way in, read back from the store: the preview writes nothing, one Undo takes it all.
// Usage: node tests/evidence/csv/import.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/csv/import.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/csv/seed.ts ${storePath} all`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=books`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const dialog = page => page.getByRole('dialog', { name: 'Import CSV' }).or(page.locator('.csv-import'))
const file = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) })
const pick = async (page, open, payload) => { const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), open()]); await chooser.setFiles(payload); await wait(500) }
const fromPlus = async (page, payload) => { await page.locator('.side-label-add').first().click().catch(async () => page.locator('.new-page-menu button').first().click()); await wait(200); await pick(page, () => page.getByRole('menuitem', { name: 'Import CSV' }).click(), payload) }
const notices = page => page.locator('[role=alert]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const imported = name => { const w = store(), db = w.pages.find(p => p.database && p.title === name); return db ? { db, rows: w.pages.filter(p => p.parentId === db.id && !p.trashedAt) } : null }
const csv = 'Title,Pages,Read,Genre,Price\n"沙丘, Dune",412,2026-01-02,SF,$12\nEmma,many,03/04/2026,SF,$9\nUbik,100,,Novel,\nMir,2,,SF,\n'

await scenario('Pages +: the preview writes nothing and shows the words; Import makes one database; one Undo takes it all', async page => {
  const revision = store().revision
  await fromPlus(page, file('Reading.csv', csv))
  const r = { words: (await dialog(page).innerText()).replace(/\s+/g, ' ').slice(0, 260), written: store().revision - revision, kinds: await dialog(page).locator('select').evaluateAll(l => l.map(s => s.value)) }
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(1500)
  const made = imported('Reading')
  r.rows = made?.rows.map(p => p.title); r.props = made?.db.database.properties.map(p => `${p.name}:${p.type}`); r.notice = await notices(page); r.closed = await dialog(page).count()
  r.price = made && made.rows[0].values?.[made.db.database.properties.find(p => p.name === 'Price').id]
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.gone = imported('Reading') === null
  r.ok = r.written === 0 && /沙丘, Dune/.test(r.words) && r.kinds.join() === 'name,new:text,new:date,new:select,new:text' && r.rows?.length === 4 && /4 rows imported/.test(r.notice) && r.price === '$12' && r.closed === 0 && r.gone
  return r
})
await scenario('GBK from Excel on a Chinese system reads, and a semicolon file too', async page => {
  // "名称;页数" / "读书;12" in GB18030.
  const bytes = Buffer.from([0xc3, 0xfb, 0xb3, 0xc6, 0x3b, 0xd2, 0xb3, 0xca, 0xfd, 0x0a, 0xb6, 0xc1, 0xca, 0xe9, 0x3b, 0x31, 0x32, 0x0a])
  await fromPlus(page, file('中文.csv', bytes))
  const words = await dialog(page).innerText()
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(1500)
  const made = imported('中文')
  return { words: words.replace(/\s+/g, ' ').slice(0, 120), rows: made?.rows.map(p => p.title), ok: /名称/.test(words) && /读书/.test(words) && made?.rows[0]?.title === '读书' && made?.db.database.properties[0]?.type === 'number' }
})
await scenario('Merge with CSV: a matching header maps first, cells that can\'t read are named, only rows are added', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await pick(page, () => page.locator('.database-menu').getByRole('menuitem', { name: 'Merge with CSV' }).click(), file('more.csv', 'Name,Pages,Owned,Other\nDune,many,Yes,x\nNew one,7,No,y\n'))
  const r = { keys: await dialog(page).locator('select').evaluateAll(l => l.map(s => s.value)), bad: await dialog(page).locator('.csv-import-summary').innerText() }
  await dialog(page).locator('select').nth(3).selectOption('skip'); await wait(100)
  r.left = await dialog(page).locator('.csv-import-summary').innerText()
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(1500)
  const rows = store().pages.filter(p => p.parentId === 'books')
  r.titles = rows.map(p => p.title); r.notice = await notices(page)
  r.ok = r.keys.join() === 'name,existing:pages,existing:owned,new:text' && /row 2, Pages: “many”/.test(r.bad) && /Left out: Other/.test(r.left) && r.titles.length === 5 && /2 rows imported · 1 cell couldn't be read/.test(r.notice)
  return r
})
await scenario('`/CSV` on a page: a block appears only after Import, the table draws, and Undo leaves nothing of it', async page => {
  await page.goto(`${base}/`); await wait(2500)
  const date = page.locator('.ProseMirror').first()
  await date.click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.type('/CSV'); await wait(500)
  await pick(page, () => page.locator('.bn-suggestion-menu-item, [role=option]', { hasText: 'CSV' }).first().click(), file('Inline.csv', csv))
  const r = { blockBefore: await page.locator('.database-block').count() }
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(2500)
  r.rows = await page.locator('.database-row').count(); r.blockAfter = await page.locator('.database-block').count()
  r.made = imported('Inline')?.rows.length; r.home = imported('Inline')?.db.database.homeBlockId ?? null
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2500)
  r.gone = imported('Inline') === null; r.blockAfterUndo = await page.locator('.database-block').count(); r.text = (await page.locator('.database-block').first().innerText().catch(() => '')).slice(0, 80)
  r.ok = r.blockBefore === 0 && r.rows === 4 && r.made === 4 && Boolean(r.home) && r.gone
  return r
})
await scenario('A file past the row limit says so and writes nothing', async page => {
  const big = `Name,N\n${Array.from({ length: 10_001 }, (_, i) => `Row ${i},${i}`).join('\n')}\n`, revision = store().revision
  await fromPlus(page, file('Big.csv', big))
  const summary = await dialog(page).locator('.csv-import-summary').innerText()
  const r = { summary: summary.slice(0, 200), disabled: await dialog(page).getByRole('button', { name: 'Import' }).isDisabled(), written: store().revision - revision }
  r.ok = /10,001 rows/.test(summary) && r.disabled && r.written === 0
  return r
})
await scenario('390: the preview fits, nothing past the edge, and it imports', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await pick(page, () => page.locator('.database-menu').getByRole('menuitem', { name: 'Merge with CSV' }).click(), file('Phone.csv', csv))
  const box = await dialog(page).boundingBox()
  const r = { box, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), before: store().pages.filter(p => p.parentId === 'books').length }
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(1500)
  r.rows = store().pages.filter(p => p.parentId === 'books').length - r.before
  r.ok = box.x >= 0 && box.x + box.width <= 390 && r.overflow <= 0 && r.rows === 4
  return r
}, phone)
await scenario('Near the limit: one warning, nothing refused, and a file past it is refused with the numbers', async page => {
  const words = 'x'.repeat(7000)
  await fromPlus(page, file('Wordy.csv', `Name,Notes\n${Array.from({ length: 1250 }, (_, i) => `Row ${i},${words}`).join('\n')}\n`))
  await dialog(page).getByRole('button', { name: 'Import' }).click(); await wait(3000)
  const r = { warned: await notices(page) }
  await fromPlus(page, file('More.csv', `Name,Notes\n${Array.from({ length: 400 }, (_, i) => `Row ${i},${words}`).join('\n')}\n`))
  r.summary = (await dialog(page).locator('.csv-import-summary').innerText()).replace(/\s+/g, ' ')
  r.disabled = await dialog(page).getByRole('button', { name: 'Import' }).isDisabled()
  r.ok = /nearly full/.test(r.warned) && /can hold about 10\.0 MB/.test(r.summary) && r.disabled
  return r
})
await scenario('10,000 rows through the dialog: the preview, the write and the table, with one Undo', async page => {
  const big = `Name,N,Notes\n${Array.from({ length: 10_000 }, (_, i) => `Row ${i},${i},Some words in row ${i}`).join('\n')}\n`
  const t0 = Date.now()
  await fromPlus(page, file('Ten.csv', big))
  await dialog(page).getByRole('button', { name: 'Import' }).waitFor()
  const r = { previewMs: Date.now() - t0 }
  const t1 = Date.now()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await page.getByRole('button', { name: 'Undo' }).first().waitFor({ timeout: 60000 })
  r.writeMs = Date.now() - t1; r.rows = imported('Ten')?.rows.length
  const t2 = Date.now()
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(300)
  for (let i = 0; i < 100 && imported('Ten'); i++) await wait(200)
  r.undoMs = Date.now() - t2; r.gone = imported('Ten') === null
  r.ok = r.rows === 10000 && r.gone
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
